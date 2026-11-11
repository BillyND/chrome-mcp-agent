// JavaScript dialogs and file inputs.

import { send, sessionOf } from '../cdp';
import { frameCall, parseRef, readyFrames } from '../frames';
import { fetchAsBase64 } from './downloads';
import { afterAction } from './page-summary';
import { prepareTab } from './tab';
import { tabTool, ToolError, type Args } from './types';

export const dialogFileTools = {
  browser_handle_dialog: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'handle_dialog');
    const dialog = sessionOf(tab.id!)?.dialog;
    if (!dialog) throw new ToolError('No dialog is open.');
    await send(tab.id!, 'Page.handleJavaScriptDialog', { accept: !!args.accept, promptText: args.promptText });
    const s = sessionOf(tab.id!);
    if (s) s.dialog = undefined;
    return afterAction(tab, `${args.accept ? 'Accepted' : 'Dismissed'} the ${dialog.type} dialog "${dialog.message}".`);
  }),

  browser_file_upload: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Tải file lên');
    const files = await Promise.all(
      ((args.files ?? []) as Args[]).map(async (f) => {
        if (f.base64) return { name: String(f.name), mimeType: String(f.mimeType ?? 'application/octet-stream'), base64: String(f.base64) };
        if (f.url) {
          const got = await fetchAsBase64(String(f.url));
          return { name: String(f.name), mimeType: String(f.mimeType ?? got.mimeType), base64: got.base64 };
        }
        throw new ToolError(`File "${f.name}" needs a url or base64 content.`);
      }),
    );
    const { frameId, local } = parseRef(args.ref);
    await readyFrames(tab.id!);
    const res = await frameCall<string>(tab.id!, frameId, { cmd: 'set-files', ref: local, files }, 30_000);
    return afterAction(tab, `${res}.`);
  }),
};
