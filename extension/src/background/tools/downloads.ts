// Saving to the Downloads folder and fetching remote files, shared by download, upload and PDF export.

import { sleep, ToolError } from './types';

const MAX_BYTES = 25 * 1024 * 1024;

/** Downloads `url` into the user's Downloads folder (with the browser's cookies) and reports where it landed. */
export async function downloadUrl(url: string, filename?: string): Promise<string> {
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id });
    if (item?.state === 'complete') return `Downloaded to ${item.filename}.`;
    if (item?.state === 'interrupted') throw new ToolError(`Download failed: ${item.error}.`);
    await sleep(400);
  }
  return 'Download started; it is still in progress (see chrome://downloads).';
}

export async function fetchAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new ToolError(`Download of ${url} failed (${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new ToolError('File is larger than 25 MB.');
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), mimeType: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
}
