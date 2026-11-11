// Which agent owns which tab, and the Chrome tab group that shows it. Every agent
// has a default tab (used when a call names none) and its tabs live in a group
// titled with the agent's label and a colour of its own, per window.

import { setAgentTab } from '../state';
import { agentLabel, pickColor } from './agent-id';
import { Scheduler } from './scheduler';

interface Store {
  /** agent -> default tab */
  defaults: Record<string, number>;
  /** tab -> owning agent */
  owners: Record<number, string>;
  /** agent -> window -> tab group */
  groups: Record<string, Record<number, number>>;
  /** agent -> group colour */
  colors: Record<string, string>;
}

const KEY = 'agents';
const empty = (): Store => ({ defaults: {}, owners: {}, groups: {}, colors: {} });
let store: Store = empty();
const loaded = chrome.storage.session.get(KEY).then((v) => {
  store = { ...empty(), ...((v[KEY] as Partial<Store> | undefined) ?? {}) };
});
const save = () => chrome.storage.session.set({ [KEY]: store }).catch(() => {});

// Choosing a tab for an agent must not interleave with another agent doing the same.
const claims = new Scheduler(1);
export const withClaimLock = <T>(fn: () => Promise<T>): Promise<T> => claims.run('claim', async () => {
  await loaded;
  return fn();
});

export const defaultTabOf = (agent: string): number | undefined => store.defaults[agent];
export const ownerOf = (tabId: number): string | undefined => store.owners[tabId];

/** Makes `tab` belong to `agent` (and optionally its default) and puts it in the agent's tab group. Call inside the claim lock. */
export async function adopt(agent: string, tab: chrome.tabs.Tab, makeDefault: boolean): Promise<void> {
  const tabId = tab.id!;
  store.owners[tabId] = agent;
  if (makeDefault) {
    store.defaults[agent] = tabId;
    await setAgentTab(tabId); // legacy single-tab key still read by the service worker entry
  }
  await ensureGrouped(agent, tab).catch(() => {});
  await save();
}

async function liveGroup(groupId: number | undefined): Promise<chrome.tabGroups.TabGroup | null> {
  if (groupId === undefined) return null;
  return chrome.tabGroups.get(groupId).catch(() => null);
}

async function ensureGrouped(agent: string, tab: chrome.tabs.Tab): Promise<void> {
  if (!chrome.tabGroups) return;
  const windowId = tab.windowId;
  const inWindow = (store.groups[agent] ??= {});
  const fresh = await chrome.tabs.get(tab.id!);
  // A tab the user keeps in a group of their own, or another agent's tab, stays where it is.
  if (fresh.groupId !== -1 && fresh.groupId !== inWindow[windowId]) return;
  let group = await liveGroup(inWindow[windowId]);
  if (!group) {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id!], createProperties: { windowId } });
    const taken = Object.entries(store.colors).filter(([a]) => a !== agent).map(([, c]) => c);
    const color = (store.colors[agent] ??= pickColor(agent, taken));
    group = (await chrome.tabGroups.update(groupId, { title: agentLabel(agent), color: color as `${chrome.tabGroups.Color}` })) ?? null;
    inWindow[windowId] = groupId;
  } else if (fresh.groupId !== group.id) {
    await chrome.tabs.group({ tabIds: [tab.id!], groupId: group.id });
  }
}

/** Short description for tab listings and results, e.g. `owned by "ChatGPT"`. */
export function ownerLabel(tabId: number): string | undefined {
  const owner = ownerOf(tabId);
  return owner ? agentLabel(owner) : undefined;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void loaded.then(() => {
    const owner = store.owners[tabId];
    delete store.owners[tabId];
    if (owner && store.defaults[owner] === tabId) delete store.defaults[owner];
    void save();
  });
});

if (chrome.tabGroups) {
  chrome.tabGroups.onRemoved.addListener((group) => {
    void loaded.then(() => {
      for (const windows of Object.values(store.groups)) {
        for (const [w, id] of Object.entries(windows)) if (id === group.id) delete windows[Number(w)];
      }
      void save();
    });
  });
}
