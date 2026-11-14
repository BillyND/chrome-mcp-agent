// What stays between the agent and the page now that access is always full: the 25 MB upload limit, the
// login / CAPTCHA hint, and the untrusted envelope around page content.

import type { ToolContent } from '../../../../shared/protocol';
import type { PageGates } from '../../messages';
import { sessionOf } from '../cdp';
import { callAllFrames } from '../frames';
import { STOPPED, TrustedError, type ToolCtx } from '../tools/types';
import { hostOf } from './site-rules';
import { FULL_ACCESS_LOGIN_HINT, HANDBACK_HINT, wrapUntrusted } from './untrusted';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Refuses files over 25 MB. `bytes` may be unknown until the file is fetched. */
export function guardUpload(name: string, bytes?: number): void {
  if (bytes !== undefined && bytes > MAX_UPLOAD_BYTES) {
    throw new TrustedError(`Refused: "${name}" is ${(bytes / 1048576).toFixed(1)} MB; Helmsman does not upload files larger than 25 MB.`);
  }
}

async function pageGates(tabId: number): Promise<PageGates> {
  const found = await callAllFrames<PageGates>(tabId, () => ({ cmd: 'detect-gates' }), 1500).catch(() => []);
  return { password: found.some((f) => f.value.password), captcha: found.some((f) => f.value.captcha) };
}

/**
 * Last step of a tool run: records the site the tab ended up on and queues the login / CAPTCHA hint (a login is the
 * agent's to do with saved secrets; a CAPTCHA goes back to the user). The content itself is sealed later, see seal().
 */
export async function finish(ctx: ToolCtx, tool: string, content: ToolContent[]): Promise<ToolContent[]> {
  if (ctx.tabId >= 0) {
    const tab = await chrome.tabs.get(ctx.tabId).catch(() => null);
    if (tab?.url) ctx.audit.host = hostOf(tab.url);
    // A page blocked by an open JS dialog cannot answer frame calls; skip the check until the dialog is handled.
    if (tool !== 'browser_request_user' && tab && !sessionOf(ctx.tabId)?.dialog) {
      const gates = await pageGates(ctx.tabId);
      if (gates.password || gates.captcha) ctx.notes.push(!gates.captcha ? FULL_ACCESS_LOGIN_HINT : HANDBACK_HINT);
    }
  }
  return content;
}

/** Wraps what came from the page in the untrusted envelope and puts Helmsman's own notes in front, outside it. */
export function seal(content: ToolContent[], notes: string[]): ToolContent[] {
  const wrapped = content.map((c) => (c.type === 'text' ? { ...c, text: wrapUntrusted(c.text) } : c));
  return notes.length ? [{ type: 'text', text: notes.join('\n') }, ...wrapped] : wrapped;
}

/** A failure may quote the page (a script error, an element label); wrap it unless Helmsman wrote the message itself. */
export function failureText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof TrustedError || message === STOPPED ? message : wrapUntrusted(message);
}
