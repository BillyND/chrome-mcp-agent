// Reading data out of the page: text, JavaScript results, text search and structured extraction.

import { send } from '../cdp';
import { callAllFrames, frameCall, parseRef, readyFrames, refPrefix } from '../frames';
import { pageHeader, prepareTab, tabTag } from './tab';
import { tabTool, text, ToolError } from './types';
import type { FindHit } from '../../content/page-data';

async function evaluateInFrame(tabId: number, frameId: number, script: string, markNonce?: string): Promise<unknown> {
  const hasReturn = /(^|[;\s{])return[\s;(]/.test(script);
  const finder = markNonce
    ? `(function f(root){const e=root.querySelector('[data-cma-eval="${markNonce}"]');if(e)return e;for(const n of root.querySelectorAll('*')){if(n.shadowRoot){const r=f(n.shadowRoot);if(r)return r;}}return null;})(document)`
    : 'undefined';
  if (frameId === 0) {
    // CDP evaluation ignores the page's Content Security Policy.
    const unmark = markNonce ? 'element?.removeAttribute("data-cma-eval");' : '';
    const body = hasReturn ? script : `return eval(${JSON.stringify(script)});`;
    const expression = `(async () => { const element = ${finder}; ${unmark} ${body}\n})()`;
    const res = await send<any>(tabId, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 20_000 });
    if (res.exceptionDetails) throw new ToolError(`Script error: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    return res.result?.value ?? (res.result?.type === 'undefined' ? undefined : res.result?.description);
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [script, hasReturn, markNonce ?? null],
    func: async (code: string, body: boolean, nonce: string | null) => {
      const element = nonce ? document.querySelector(`[data-cma-eval="${nonce}"]`) : undefined;
      element?.removeAttribute('data-cma-eval');
      // eslint-disable-next-line no-new-func
      const fn = body ? new Function('element', `return (async () => {${code}\n})()`) : new Function('element', `return eval(${JSON.stringify(code)})`);
      const value = await fn(element);
      return JSON.parse(JSON.stringify(value ?? null));
    },
  });
  return result?.result;
}

/** Runs a script in the page (or in the frame holding `ref`, passing that element in). Used by evaluate and the clipboard. */
export async function evaluate(tabId: number, script: string, ref?: string): Promise<unknown> {
  if (!ref) return evaluateInFrame(tabId, 0, script);
  const { frameId, local } = parseRef(ref);
  const nonce = crypto.randomUUID();
  await readyFrames(tabId);
  await frameCall(tabId, frameId, { cmd: 'mark-for-eval', ref: local, nonce });
  return evaluateInFrame(tabId, frameId, script, nonce);
}

export const pageDataTools = {
  browser_get_text: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Đọc nội dung');
    let out: string;
    if (args.ref) {
      const { frameId, local } = parseRef(args.ref);
      out = await frameCall<string>(tab.id!, frameId, { cmd: 'get-text', ref: local });
    } else {
      const parts = await callAllFrames<string>(tab.id!, () => ({ cmd: 'get-text' }));
      out = parts
        .filter((p) => p.value.trim())
        .map(({ frame, value }) => (frame.frameId === 0 ? value : `\n--- frame f${frame.frameId} (${frame.url}) ---\n${value}`))
        .join('\n');
    }
    return text(`${await pageHeader(tab)}\n\n${out || '(no text)'}`);
  }),

  browser_evaluate: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Chạy script');
    const value = await evaluate(tab.id!, String(args.script), args.ref);
    const json = value === undefined ? 'undefined' : JSON.stringify(value, null, 2);
    return text(`${tabTag(tab.id!)} result:\n${json}`);
  }),

  browser_find: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, `Tìm "${args.text}"`);
    const max = Math.min(Number(args.maxResults ?? 20), 100);
    const found = await callAllFrames<FindHit[]>(tab.id!, (f) => ({
      cmd: 'find-text',
      text: String(args.text),
      caseSensitive: !!args.caseSensitive,
      max,
      prefix: refPrefix(f.frameId),
    }));
    const lines = found.flatMap(({ frame, value }) =>
      value.map((h) => `- ${h.label} [ref=${h.ref}]${frame.frameId === 0 ? '' : ` (iframe f${frame.frameId})`}${h.interactive ? '' : ' (plain text)'}: …${h.snippet}…`),
    );
    const header = await pageHeader(tab);
    if (!lines.length) return text(`${header}\n\nNo visible text matches "${args.text}".`);
    return text(`${header}\n\n${lines.length} match(es) for "${args.text}" (refs work with the other tools):\n${lines.slice(0, max).join('\n')}`);
  }),

  browser_extract: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Trích xuất dữ liệu');
    const what = (args.what as string[] | undefined)?.length ? (args.what as string[]) : ['meta', 'headings', 'links', 'tables', 'forms'];
    const max = Math.min(Number(args.maxItems ?? 100), 500);
    const merged: Record<string, unknown[] | unknown> = {};
    const scoped = args.ref ? parseRef(args.ref) : undefined;
    const answers = scoped
      ? [{ frame: { frameId: scoped.frameId }, value: await frameCall<Record<string, unknown>>(tab.id!, scoped.frameId, { cmd: 'extract', what, ref: scoped.local, max, prefix: refPrefix(scoped.frameId), top: false }) }]
      : await callAllFrames<Record<string, unknown>>(tab.id!, (f) => ({ cmd: 'extract', what, max, prefix: refPrefix(f.frameId), top: f.frameId === 0 }));
    for (const { value } of answers) {
      for (const [key, v] of Object.entries(value)) {
        merged[key] = Array.isArray(v) ? [...((merged[key] as unknown[] | undefined) ?? []), ...v] : v;
      }
    }
    const json = JSON.stringify(merged, null, 1);
    return text(`${await pageHeader(tab)}\n\nExtracted (${what.join(', ')}):\n${json}`);
  }),
};
