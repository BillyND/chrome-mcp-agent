// Visual capture: screenshots (viewport, full page, one element) and PDF export.

import type { ToolContent } from '../../../../shared/protocol';
import { send } from '../cdp';
import { downloadUrl } from './downloads';
import { elementBox, locate } from './locate';
import { overlay } from './overlay';
import { pageHeader, prepareTab } from './tab';
import { sleep, tabTool, text, ToolError } from './types';

type Clip = { x: number; y: number; width: number; height: number };

/** Pixel width from a base64 JPEG's SOF marker. */
function jpegWidth(b64: string): number | null {
  const head = atob(b64.slice(0, 80_000));
  for (let i = 2; i + 8 < head.length; ) {
    const marker = head.charCodeAt(i + 1);
    const len = (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3);
    if (marker >= 0xc0 && marker <= 0xc2) return (head.charCodeAt(i + 7) << 8) | head.charCodeAt(i + 8);
    i += 2 + len;
  }
  return null;
}

const timeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/**
 * Chrome may not paint a tab that is hidden behind another one, which stalls captures. When that
 * happens, show the tab for the capture only and put the user's tab back afterwards.
 */
async function capture(tabId: number, params: object): Promise<{ data: string }> {
  try {
    return await timeout(send<{ data: string }>(tabId, 'Page.captureScreenshot', params), 6000);
  } catch (e) {
    if ((e as Error).message !== 'timeout') throw e;
  }
  const tab = await chrome.tabs.get(tabId);
  const [front] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(tabId, { active: true });
  try {
    await sleep(150);
    return await timeout(send<{ data: string }>(tabId, 'Page.captureScreenshot', params), 10_000);
  } finally {
    if (front?.id !== undefined && front.id !== tabId) await chrome.tabs.update(front.id, { active: true }).catch(() => {});
  }
}

async function screenshot(tabId: number, clip?: Clip, full = false): Promise<ToolContent> {
  const metrics = await send<any>(tabId, 'Page.getLayoutMetrics');
  const vp = metrics.cssLayoutViewport;
  let params: any = { format: 'jpeg', quality: 80 };
  if (full) {
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const height = Math.min(size.height, 12_000);
    const scale = Math.min(1, 1600 / size.width);
    params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height, scale } };
  } else if (clip) {
    params = { ...params, captureBeyondViewport: true, clip: { x: clip.x + vp.pageX, y: clip.y + vp.pageY, width: Math.max(1, clip.width), height: Math.max(1, clip.height), scale: 1 } };
  } else {
    params = { ...params, clip: { x: vp.pageX, y: vp.pageY, width: vp.clientWidth, height: vp.clientHeight, scale: 1 } };
  }
  let shot = await capture(tabId, params);
  // Captures come out in device pixels (2x on Retina). Rescale so 1 image pixel = 1 CSS pixel
  // (or the intended downscale for full pages), measured from the image itself.
  const want = params.clip.width * params.clip.scale;
  const got = jpegWidth(shot.data);
  if (got && Math.abs(got - want) > 1) {
    params = { ...params, clip: { ...params.clip, scale: (params.clip.scale * want) / got } };
    shot = await capture(tabId, params);
  }
  if (shot.data.length > 3_000_000) {
    shot = await capture(tabId, { ...params, quality: 45, clip: params.clip && { ...params.clip, scale: (params.clip.scale ?? 1) * 0.6 } });
  }
  return { type: 'image', data: shot.data, mimeType: 'image/jpeg' };
}

const PAPER: Record<string, { width: number; height: number }> = {
  A4: { width: 8.27, height: 11.69 },
  Letter: { width: 8.5, height: 11 },
};

export const captureTools = {
  browser_screenshot: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Chụp màn hình');
    const tabId = tab.id!;
    await overlay(tabId, { type: 'hide' });
    await sleep(120);
    let image: ToolContent;
    let note: string;
    if (args.ref) {
      const t = await locate(tabId, args.ref);
      const box = elementBox(t);
      image = await screenshot(tabId, box);
      note = `Element ${t.prep.label}: ${Math.round(box.width)}x${Math.round(box.height)} px. Image pixel (x,y) = browser_mouse_xy with ref "${args.ref}" and the same x,y.`;
    } else if (args.fullPage) {
      image = await screenshot(tabId, undefined, true);
      note = 'Full page (may be scaled down). For clicks, scroll the area into view and take a viewport screenshot.';
    } else {
      image = await screenshot(tabId);
      const vp = (await send<any>(tabId, 'Page.getLayoutMetrics')).cssLayoutViewport;
      note = `Viewport ${Math.round(vp.clientWidth)}x${Math.round(vp.clientHeight)} px; image pixel (x,y) = browser_mouse_xy x,y (no ref).`;
    }
    return [{ type: 'text', text: `${await pageHeader(tab)}\n${note}` }, image];
  }),

  browser_pdf: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Xuất PDF');
    const paper = PAPER[String(args.format ?? 'A4')] ?? PAPER.A4;
    const pdf = await send<{ data: string }>(tab.id!, 'Page.printToPDF', {
      landscape: !!args.landscape,
      printBackground: args.printBackground !== false,
      paperWidth: paper.width,
      paperHeight: paper.height,
      pageRanges: args.pageRanges ? String(args.pageRanges) : undefined,
      preferCSSPageSize: true,
    });
    const bytes = Math.round((pdf.data.length * 3) / 4);
    const header = await pageHeader(tab);
    if (args.returnBase64) {
      if (bytes > 8 * 1024 * 1024) throw new ToolError(`The PDF is ${(bytes / 1048576).toFixed(1)} MB; too large to return inline. Omit returnBase64 to save it to Downloads.`);
      return text(`${header}\nPDF (${bytes} bytes), base64:\n${pdf.data}`);
    }
    const name = String(args.filename ?? 'page.pdf').replace(/[\\/:*?"<>|]/g, '_');
    const saved = await downloadUrl(`data:application/pdf;base64,${pdf.data}`, name.endsWith('.pdf') ? name : `${name}.pdf`);
    return text(`${header}\nSaved the page as PDF (${Math.round(bytes / 1024)} KB): ${saved}`);
  }),
};
