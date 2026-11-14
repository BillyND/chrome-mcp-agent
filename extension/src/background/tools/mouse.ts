// Pointer tools: click, hover, mouse at coordinates, scroll and drag-and-drop.

import { send, sessionOf } from '../cdp';
import { frameCall } from '../frames';
import { clickAt, clickTarget, modifierMask, mouse, withClickProbe } from './input';
import { elementBox, locate } from './locate';
import { afterAction } from './page-summary';
import { glide, settleCursor } from './overlay';
import { prepareTab } from './tab';
import { checkAbort, sleep, tabTool, ToolError } from './types';

const viewportOf = async (tabId: number) => (await send<any>(tabId, 'Page.getLayoutMetrics')).cssLayoutViewport;

const POINTER_VERBS: Record<string, string> = {
  click: 'Clicked',
  double_click: 'Double-clicked',
  right_click: 'Right-clicked',
  move: 'Moved the mouse to',
  drag: 'Dragged from',
};

export const mouseTools = {
  browser_click: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, `Bấm ${args.element ?? args.ref}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    checkAbort(ctx);
    const fallback = await clickTarget(tab.id!, t, { button: args.button, clickCount: args.doubleClick ? 2 : 1, modifiers: args.modifiers });
    await sleep(250);
    const warn = (t.prep.coveredBy ? ` (note: ${t.prep.coveredBy} was on top of it)` : '') + (fallback ? ' (delivered as a DOM click inside its frame)' : '');
    const verb = args.doubleClick ? 'Double-clicked' : args.button === 'right' ? 'Right-clicked' : 'Clicked';
    return afterAction(tab, `${verb} ${t.prep.label}${warn}.`);
  }),

  browser_hover: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, `Rê chuột ${args.element ?? args.ref}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    await mouse(tab.id!, 'mouseMoved', t.x, t.y);
    await sleep(400);
    return afterAction(tab, `Hovering over ${t.prep.label}.`);
  }),

  browser_mouse_xy: tabTool(async (args, ctx) => {
    const action = (args.action as string) ?? 'click';
    const tab = await prepareTab(ctx, action === 'drag' ? 'Kéo chuột' : 'Bấm chuột');
    const tabId = tab.id!;
    const target = args.ref ? await locate(tabId, args.ref, true) : undefined;
    const box = target ? elementBox(target) : { x: 0, y: 0 };
    // CDP takes fractional CSS pixels; rounding here would shift canvas clicks by a pixel.
    const x = box.x + Number(args.x);
    const y = box.y + Number(args.y);
    const vp = await viewportOf(tabId);
    if (x < 0 || y < 0 || x > vp.clientWidth || y > vp.clientHeight) {
      throw new ToolError(`Point (${x}, ${y}) is outside the visible viewport (${Math.round(vp.clientWidth)}x${Math.round(vp.clientHeight)}). Scroll it into view first.`);
    }
    if (action === 'drag' && (args.toX === undefined || args.toY === undefined)) throw new ToolError('toX and toY are required for drag.');
    const ex = box.x + Number(args.toX);
    const ey = box.y + Number(args.toY);
    await glide(tabId, x, y);
    checkAbort(ctx);
    const modifiers = args.modifiers as string[] | undefined;
    const button = action === 'right_click' ? 'right' : 'left';
    const clickCount = action === 'double_click' ? 2 : 1;

    const perform = async () => {
      if (action === 'move') {
        await mouse(tabId, 'mouseMoved', x, y, { modifiers: modifierMask(modifiers) });
      } else if (action === 'drag') {
        await mouse(tabId, 'mouseMoved', x, y);
        await mouse(tabId, 'mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
          await mouse(tabId, 'mouseMoved', x + ((ex - x) * i) / steps, y + ((ey - y) * i) / steps, { button: 'left', buttons: 1 });
          await sleep(12);
        }
        await mouse(tabId, 'mouseReleased', ex, ey, { button: 'left', buttons: 0, clickCount: 1 });
        await settleCursor(tabId, ex, ey);
      } else {
        await clickAt(tabId, x, y, { button, clickCount, modifiers });
      }
    };
    // With a ref we know the frame, so a press the browser misroutes can be detected and redone in-frame.
    const fallback = await withClickProbe(tabId, action === 'move' ? undefined : target, perform, (t) =>
      frameCall(tabId, t.frameId, {
        cmd: 'synthetic-pointer',
        ref: t.local,
        from: { x: Number(args.x), y: Number(args.y) },
        to: action === 'drag' ? { x: Number(args.toX), y: Number(args.toY) } : undefined,
        button,
        clickCount,
      }),
    );
    await sleep(250);
    const where = target ? ` of ${target.prep.label}` : '';
    const to = action === 'drag' ? ` to (${args.toX}, ${args.toY})` : '';
    return afterAction(
      tab,
      `${POINTER_VERBS[action] ?? action} (${args.x}, ${args.y})${where}${to} → viewport (${Math.round(x)}, ${Math.round(y)})${fallback ? ' (delivered as DOM events inside its frame)' : ''}.`,
      6000,
    );
  }),

  browser_scroll: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Cuộn trang');
    const tabId = tab.id!;
    if (args.toRef) {
      const t = await locate(tabId, args.toRef, true);
      await glide(tabId, t.x, t.y);
      return afterAction(tab, `Scrolled ${t.prep.label} into view.`);
    }
    const amount = Number(args.amount ?? 600);
    const dir = (args.direction as string) ?? 'down';
    const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
    const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
    let x: number;
    let y: number;
    if (args.ref) {
      ({ x, y } = await locate(tabId, args.ref, false));
    } else {
      const vp = await viewportOf(tabId);
      x = Math.round(vp.clientWidth / 2);
      y = Math.round(vp.clientHeight / 2);
    }
    await glide(tabId, x, y);
    const before = await frameCall<any>(tabId, 0, { cmd: 'scroll-info' }).catch(() => null);
    await mouse(tabId, 'mouseWheel', x, y, { deltaX: dx, deltaY: dy });
    await sleep(350);
    const after = await frameCall<any>(tabId, 0, { cmd: 'scroll-info' }).catch(() => null);
    let note = '';
    if (before && after && !args.ref) {
      note = after.scrollY === before.scrollY && dy !== 0
        ? ' The page did not move (end reached, or the scrollable area is an inner element — pass its ref).'
        : ` Now at ${after.scrollY}px of ${after.scrollHeight}px.`;
    }
    return afterAction(tab, `Scrolled ${dir} ${amount}px.${note}`);
  }),

  browser_drag: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Kéo thả');
    const tabId = tab.id!;
    const a = await locate(tabId, args.startRef);
    await glide(tabId, a.x, a.y);
    const session = sessionOf(tabId);
    if (session) session.dragData = undefined;
    await send(tabId, 'Input.setInterceptDrags', { enabled: true }).catch(() => {});
    await mouse(tabId, 'mouseMoved', a.x, a.y);
    await mouse(tabId, 'mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 });
    const b = await locate(tabId, args.endRef, false);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * i) / steps);
      await mouse(tabId, 'mouseMoved', x, y, { button: 'left', buttons: 1 });
      if (i === 1) await sleep(60);
    }
    await settleCursor(tabId, b.x, b.y);
    const data = sessionOf(tabId)?.dragData;
    if (data) {
      // The page started an HTML5 drag: complete it with drag events.
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send(tabId, 'Input.dispatchDragEvent', { type, x: b.x, y: b.y, data });
    }
    await mouse(tabId, 'mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1 });
    await send(tabId, 'Input.setInterceptDrags', { enabled: false }).catch(() => {});
    await sleep(250);
    return afterAction(tab, `Dragged ${a.prep.label} onto ${b.prep.label}.`);
  }),
};
