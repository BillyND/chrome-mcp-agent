// Messages from an extension page to the background service worker.

import type { RuntimeMessage } from '../messages';

export const send = <T = unknown,>(msg: RuntimeMessage) => chrome.runtime.sendMessage(msg) as Promise<T>;
/** Fire and forget: the background may be restarting, and the next state refresh shows the outcome. */
export const post = (msg: RuntimeMessage): void => void chrome.runtime.sendMessage(msg).catch(() => {});
