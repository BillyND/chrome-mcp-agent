// Per-site rules: which hosts the agent may use freely, must ask about, or may not touch.
// Pure functions; storage lives in store.ts.

import type { SiteAction } from '../../messages';

export type SiteRules = Record<string, SiteAction>;

export interface SiteDecision {
  action: SiteAction;
  /** Where the verdict came from: a rule the user made, or nothing (unknown sites are allowed). */
  source: 'user' | 'none';
  /** The rule host that matched. */
  rule?: string;
  host: string;
}

const IP = /^(\d{1,3}\.){3}\d{1,3}$|:/;

/** Lowercase host of an http(s) URL; empty for anything else (about:, file:, data:, garbage). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/\.$/, '') : '';
  } catch {
    return '';
  }
}

/** Turns what a person typed ("https://www.Example.com/x", "example.com") into a rule host. */
export function normalizeRuleHost(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  const host = hostOf(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `https://${s}`);
  return host.replace(/^www\./, '');
}

/** The rule key under which "run scripts on <host>" is allowed for good; it cannot clash with a real host. */
export const scriptRule = (host: string): string => `script:${host}`;

/** A rule host matches itself and its subdomains; IP addresses only match exactly. */
export function hostMatches(host: string, rule: string): boolean {
  if (host === rule) return true;
  return !IP.test(host) && host.endsWith(`.${rule}`);
}

/** The most specific (longest) matching key, so "mail.example.com" beats "example.com". */
function bestRule(host: string, rules: SiteRules): string | undefined {
  let best: string | undefined;
  for (const key of Object.keys(rules)) {
    if (hostMatches(host, key) && (!best || key.length > best.length)) best = key;
  }
  return best;
}

export function decideSite(url: string, rules: SiteRules): SiteDecision {
  const host = hostOf(url);
  if (!host) return { action: 'allow', source: 'none', host };
  const rule = bestRule(host, rules);
  if (rule) return { action: rules[rule], source: 'user', rule, host };
  return { action: 'allow', source: 'none', host };
}

/** URLs a tool is about to open or fetch, taken from its arguments, so their sites are checked before anything runs. */
export function targetUrlsOf(tool: string, args: Record<string, unknown>): string[] {
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (!url) return [];
  const opens =
    tool === 'browser_navigate' ? (args.action ?? 'goto') === 'goto'
    : tool === 'browser_tabs' || tool === 'browser_windows' ? args.action === 'new'
    : tool === 'browser_download' || tool === 'browser_cookies';
  if (!opens) return [];
  return [/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`];
}
