// Persistent policy state: the user's site rules and tuning in chrome.storage.local, and the
// short-lived answers to "Allow <agent> on <host>?" in chrome.storage.session.

import type { SiteAction, SitesView } from '../../messages';
import { DEFAULT_BLOCKS } from './default-blocks';
import type { SiteRules } from './site-rules';

const RULES_KEY = 'siteRules';
const SETTINGS_KEY = 'policySettings';
const GRANTS_KEY = 'siteGrants';

export interface PolicySettings {
  /** How long a site or sensitive-action prompt waits before counting as declined. */
  approvalTimeoutMs: number;
  /** How long browser_request_user waits for the user. */
  handbackTimeoutMs: number;
  /** How long "Allow once" lasts for an agent on a host. */
  grantMs: number;
  /** How long a declined host stays declined for that agent, so it cannot nag the user in a loop. */
  denyMs: number;
  /** Let browser_evaluate run on every site that is not blocked, without asking. */
  scriptsEverywhere: boolean;
}

export const DEFAULT_SETTINGS: PolicySettings = {
  approvalTimeoutMs: 120_000,
  handbackTimeoutMs: 600_000,
  grantMs: 30 * 60_000,
  denyMs: 60_000,
  scriptsEverywhere: false,
};

export async function getSettings(): Promise<PolicySettings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<PolicySettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function getRules(): Promise<SiteRules> {
  return ((await chrome.storage.local.get(RULES_KEY))[RULES_KEY] as SiteRules | undefined) ?? {};
}

// Read-modify-write is chained so two quick changes never overwrite each other.
let writes: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = writes.then(fn, fn);
  writes = run.catch(() => {});
  return run;
};

/** Sets the rule for a host, or removes it with `null`. */
export const setRule = (host: string, action: SiteAction | null): Promise<void> =>
  serial(async () => {
    const rules = { ...(await getRules()) };
    if (action) rules[host] = action;
    else delete rules[host];
    await chrome.storage.local.set({ [RULES_KEY]: rules });
  });

/** Turns "run page scripts on every site" on or off. */
export const setScriptsEverywhere = (enabled: boolean): Promise<void> =>
  serial(async () => {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...(await getSettings()), scriptsEverywhere: enabled } });
  });

/** The user's rules and the built-in blocks they have not unblocked, for the popup. */
export async function sitesView(): Promise<SitesView> {
  const rules = await getRules();
  return {
    rules: Object.entries(rules).map(([host, action]) => ({ host, action })).sort((a, b) => a.host.localeCompare(b.host)),
    defaults: DEFAULT_BLOCKS.map((b) => ({ host: b.host, category: b.category, unblocked: rules[b.host] === 'allow' })).filter((d) => !d.unblocked),
  };
}

interface Grant {
  allow: boolean;
  until: number;
}

const grantKey = (agent: string, host: string) => `${agent}|${host}`;

export async function getGrant(agent: string, host: string): Promise<boolean | undefined> {
  const grants = ((await chrome.storage.session.get(GRANTS_KEY))[GRANTS_KEY] as Record<string, Grant> | undefined) ?? {};
  const g = grants[grantKey(agent, host)];
  return g && g.until > Date.now() ? g.allow : undefined;
}

export const setGrant = (agent: string, host: string, allow: boolean, ms: number): Promise<void> =>
  serial(async () => {
    const grants = ((await chrome.storage.session.get(GRANTS_KEY))[GRANTS_KEY] as Record<string, Grant> | undefined) ?? {};
    const now = Date.now();
    for (const [k, g] of Object.entries(grants)) if (g.until <= now) delete grants[k];
    grants[grantKey(agent, host)] = { allow, until: now + ms };
    await chrome.storage.session.set({ [GRANTS_KEY]: grants });
  });
