// Browser-level data and windows (not tied to one page): downloads, cookies, history, windows.

import { siteGate, guardDownload } from '../policy/guard';
import { adopt, withClaimLock } from './agents';
import { downloadUrl } from './downloads';
import { pageHeader, resolveTab, waitForLoad } from './tab';
import { freeTool, text, ToolError, type Args, type ToolCtx } from './types';

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Which site a cookie call is about; the site policy applies to it like to a page. */
async function cookieScope(args: Args, ctx: ToolCtx): Promise<{ url?: string }> {
  if (args.url) return { url: String(args.url) };
  if (args.domain) {
    await siteGate(ctx, `https://${String(args.domain).replace(/^\./, '')}/`);
    return {};
  }
  const tab = await resolveTab(ctx.agent, args.tabId);
  const url = tab.url ?? '';
  await siteGate(ctx, url);
  if (!/^https?:/.test(url)) throw new ToolError('The tab is not on a website; pass url or domain.');
  return { url };
}

const describeCookie = (c: chrome.cookies.Cookie) => {
  const flags = [c.secure && 'secure', c.httpOnly && 'httpOnly', c.sameSite !== 'unspecified' && `sameSite=${c.sameSite}`, c.session ? 'session' : `expires ${new Date((c.expirationDate ?? 0) * 1000).toISOString().slice(0, 10)}`];
  return `- ${c.name}=${clip(c.value)} (${c.domain}${c.path}; ${flags.filter(Boolean).join(', ')})`;
};

function cookieUrl(c: { domain?: string; path?: string; secure?: boolean }, fallback?: string): string {
  if (fallback) return fallback;
  return `http${c.secure ? 's' : ''}://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`;
}

export const browserDataTools = {
  browser_download: freeTool(async (args, ctx) => {
    await guardDownload(ctx, String(args.url));
    return text(await downloadUrl(String(args.url), args.filename ? String(args.filename) : undefined));
  }),

  browser_cookies: freeTool(async (args, ctx) => {
    const action = String(args.action ?? 'get');
    if (action === 'set') {
      if (!args.name || args.value === undefined) throw new ToolError('name and value are required for "set".');
      const { url } = await cookieScope(args, ctx);
      const set = await chrome.cookies.set({
        url: cookieUrl({ domain: args.domain, path: args.path, secure: args.secure }, url),
        name: String(args.name),
        value: String(args.value),
        domain: args.domain ? String(args.domain) : undefined,
        path: args.path ? String(args.path) : undefined,
        secure: args.secure,
        httpOnly: args.httpOnly,
        sameSite: args.sameSite,
        expirationDate: args.expiresInDays ? Date.now() / 1000 + Number(args.expiresInDays) * 86400 : undefined,
      });
      if (!set) throw new ToolError('Chrome refused the cookie (check the domain, secure flag and sameSite).');
      return text(`Set cookie:\n${describeCookie(set)}`);
    }
    if (action === 'delete') {
      if (!args.name) throw new ToolError('name is required for "delete".');
      const { url } = await cookieScope(args, ctx);
      const target = cookieUrl({ domain: args.domain, path: args.path }, url);
      const removed = await chrome.cookies.remove({ url: target, name: String(args.name) });
      return text(removed ? `Deleted cookie ${args.name} for ${target}.` : `No cookie named ${args.name} for ${target}.`);
    }
    const scope = await cookieScope(args, ctx);
    const cookies = await chrome.cookies.getAll({ ...scope, name: args.name ? String(args.name) : undefined, domain: args.domain ? String(args.domain) : undefined });
    if (!cookies.length) return text('No cookies match.');
    return text(`${cookies.length} cookie(s)${scope.url ? ` for ${scope.url}` : ''}:\n${cookies.slice(0, 200).map(describeCookie).join('\n')}`);
  }),

  browser_history: freeTool(async (args) => {
    const days = Number(args.days ?? 30);
    const items = await chrome.history.search({
      text: String(args.text ?? ''),
      maxResults: Math.min(Number(args.maxResults ?? 20), 100),
      startTime: Date.now() - days * 86_400_000,
    });
    if (!items.length) return text(`No history entries in the last ${days} day(s)${args.text ? ` matching "${args.text}"` : ''}.`);
    return text(items.map((h) => `- ${h.title || '(no title)'} — ${h.url} (visits ${h.visitCount ?? 0}, last ${new Date(h.lastVisitTime ?? 0).toISOString().slice(0, 16).replace('T', ' ')})`).join('\n'));
  }),

  browser_windows: freeTool(async (args, ctx) => {
    const action = String(args.action ?? 'list');
    if (action === 'new') {
      const win = await chrome.windows.create({
        url: args.url ? String(args.url) : undefined,
        focused: !!args.focused,
        incognito: args.incognito || undefined,
        width: args.width,
        height: args.height,
        state: args.state,
      });
      if (!win) throw new ToolError('Chrome did not open the window.');
      const tab = win.tabs?.[0];
      if (!tab?.id) return text(`Opened window ${win.id}.`);
      await withClaimLock(() => adopt(ctx.agent, tab, true));
      if (args.url) await waitForLoad(tab.id, 30_000);
      return text(`Opened window ${win.id} with tab ${tab.id}; it is now your default tab.\n\n${await pageHeader(tab)}`);
    }
    if (action === 'close' || action === 'focus') {
      if (args.windowId === undefined) throw new ToolError(`windowId is required for "${action}".`);
      if (action === 'close') await chrome.windows.remove(args.windowId);
      else await chrome.windows.update(args.windowId, { focused: true, drawAttention: false });
      return text(`${action === 'close' ? 'Closed' : 'Focused'} window ${args.windowId}.`);
    }
    const windows = await chrome.windows.getAll({ populate: true });
    return text(windows
      .map((w) => `Window ${w.id}: ${w.type}${w.incognito ? ', incognito' : ''}${w.focused ? ', focused' : ''}, ${w.state}, ${w.width}x${w.height}, ${w.tabs?.length ?? 0} tab(s)`)
      .join('\n'));
  }),
};
