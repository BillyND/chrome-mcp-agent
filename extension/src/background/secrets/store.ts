// The user's secrets: saved from the popup into chrome.storage.local, read here to type them
// into pages and to hide them from tool output. They never leave this browser profile.

import { isValidSecret, type Secrets } from './redact';

const KEY = 'secrets';
let cache: Secrets | undefined;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && KEY in changes) cache = undefined;
});

export async function loadSecrets(): Promise<Secrets> {
  if (!cache) {
    const stored = (await chrome.storage.local.get(KEY))[KEY] as Secrets | undefined;
    cache = Object.fromEntries(Object.entries(stored ?? {}).filter(([name, value]) => typeof value === 'string' && isValidSecret(name, value)));
  }
  return cache;
}
