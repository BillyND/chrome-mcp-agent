// Pictures of a page must not show secrets: while `capture` runs, every frame hides password
// fields, fields holding a vault secret and text showing one. Always lifted afterwards.

import { frameCall, readyFrames } from '../frames';
import { ToolError } from '../tools/types';
import { loadSecrets } from './store';

/** Runs `capture` with the page's sensitive values masked in every frame; refuses to run it when some frame could not be masked. */
export async function withSecretsMasked<T>(tabId: number, capture: () => Promise<T>): Promise<T> {
  const values = Object.values(await loadSecrets());
  const frames = await readyFrames(tabId);
  try {
    const results = await Promise.allSettled(frames.map((f) => frameCall(tabId, f.frameId, { cmd: 'mask-secrets', values })));
    if (results.some((r) => r.status === 'rejected')) {
      throw new ToolError('Could not hide the sensitive fields in every frame of the page, so no picture was taken. Try again once the page has finished loading.');
    }
    return await capture();
  } finally {
    await Promise.allSettled(frames.map((f) => frameCall(tabId, f.frameId, { cmd: 'unmask-secrets' }, 3000)));
  }
}
