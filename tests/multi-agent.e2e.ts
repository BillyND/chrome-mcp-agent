// End-to-end: several AI agents sharing one Chrome (parallel tabs, tab groups, ordering,
// Stop) and the browser_* tools added for them.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { call, refOf, SITE_A, startHarness, stopHarness, tabIdOf, type Harness } from './support/harness';

let h: Harness;

const A = 'agent-a';
const B = 'agent-b';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const page = (query: string) => `${SITE_A}/index.html?${query}`;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await stopHarness(h);
});

/** Evaluates in a tab and returns the JSON result text after the "result:" line. */
async function evalIn(agent: string, tabId: number, script: string): Promise<string> {
  const r = await call('browser_evaluate', { script, tabId }, agent);
  expect(r.isError, r.text).toBeFalsy();
  return r.text.split('result:\n')[1];
}

const groupsInChrome = () =>
  h.sw.evaluate(async () => {
    const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
    return groups.map((g) => ({ id: g.id, title: g.title, color: g.color, tabs: tabs.filter((t) => t.groupId === g.id).map((t) => t.id) }));
  });

async function popupSwitch(): Promise<{ toggle: () => Promise<void>; close: () => Promise<void> }> {
  const popup = await h.ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(h.sw.url()).host}/popup.html`);
  return { toggle: () => popup.locator('#enabled').click(), close: () => popup.close() };
}

test.describe.configure({ mode: 'serial' });

let tabA: number;
let tabB: number;

test('each agent gets its own tab in its own coloured tab group', async () => {
  const [ra, rb] = await Promise.all([
    call('browser_tabs', { action: 'new', url: page('a') }, A),
    call('browser_tabs', { action: 'new', url: page('b') }, B),
  ]);
  expect(ra.isError, ra.text).toBeFalsy();
  expect(rb.isError, rb.text).toBeFalsy();
  tabA = tabIdOf(ra.text);
  tabB = tabIdOf(rb.text);
  expect(tabA).not.toBe(tabB);
  // Results name the tab and its owner.
  expect(ra.text).toContain(`Tab ${tabA} (${A})`);
  expect(rb.text).toContain(`Tab ${tabB} (${B})`);

  const groups = await groupsInChrome();
  const ga = groups.find((g) => g.title === A);
  const gb = groups.find((g) => g.title === B);
  expect(ga?.tabs).toContain(tabA);
  expect(gb?.tabs).toContain(tabB);
  expect(ga!.tabs).not.toContain(tabB);
  expect(ga!.color).not.toBe(gb!.color);

  // A second tab of the same agent joins that agent's group instead of making a new one.
  const again = await call('browser_tabs', { action: 'new', url: page('a2') }, A);
  const tabA2 = tabIdOf(again.text);
  const after = await groupsInChrome();
  expect(after.filter((g) => g.title === A)).toHaveLength(1);
  expect(after.find((g) => g.title === A)!.tabs).toEqual(expect.arrayContaining([tabA, tabA2]));
  // The newest tab is the agent's default; calls without tabId follow it.
  expect(await evalIn(A, tabA2, 'location.search')).toContain('a2');
  expect((await call('browser_evaluate', { script: 'location.search' }, A)).text).toContain('a2');
  await call('browser_tabs', { action: 'close', tabId: tabA2 }, A);
  await call('browser_tabs', { action: 'select', tabId: tabA }, A);
  expect((await call('browser_evaluate', { script: 'location.search' }, A)).text).toContain('?a');
  expect((await call('browser_evaluate', { script: 'location.search' }, B)).text).toContain('?b');
});

test('an agent without a tab never takes one that another agent owns', async () => {
  const late = 'agent-late';
  const list = (await call('browser_tabs', { action: 'list' }, late)).text;
  expect(list).toContain(`used by ${A}`);
  expect(list).toContain(`used by ${B}`);
  const r = await call('browser_snapshot', {}, late);
  expect(r.isError, r.text).toBeFalsy();
  const lateTab = tabIdOf(r.text);
  expect([tabA, tabB]).not.toContain(lateTab);
  expect(r.text).toContain(`Tab ${lateTab} (${late})`);
  const after = (await call('browser_tabs', { action: 'list' }, late)).text;
  const mine = after.split('\n').filter((l) => l.includes('YOUR DEFAULT TAB'));
  expect(mine).toHaveLength(1);
  expect(mine[0]).toContain(`[${lateTab}]`);
});

test('two agents type, click and snapshot at the same time in different tabs', async () => {
  const snapA = (await call('browser_snapshot', {}, A)).text;
  const snapB = (await call('browser_snapshot', {}, B)).text;
  expect(snapA).toContain(`Tab ${tabA}`);
  expect(snapB).toContain(`Tab ${tabB}`);
  const field = refOf(snapA, 'Họ tên', 'textbox');
  const inc = refOf(snapB, 'Tăng', 'button');
  const long = 'Xin chào thế giới '.repeat(7).trim();

  const typeInA = () => call('browser_type', { ref: field, text: long, slowly: true }, A);
  const workInB = async () => {
    for (let i = 0; i < 4; i++) {
      const r = await call('browser_click', { ref: inc }, B);
      expect(r.isError, r.text).toBeFalsy();
    }
    expect((await call('browser_snapshot', {}, B)).isError).toBeFalsy();
    expect((await call('browser_get_text', {}, B)).isError).toBeFalsy();
  };
  const timed = async (f: () => Promise<unknown>) => {
    const t = Date.now();
    await f();
    return Date.now() - t;
  };

  const aAlone = await timed(typeInA);
  const bAlone = await timed(workInB);
  const wallStart = Date.now();
  const [typed] = await Promise.all([typeInA(), workInB()]);
  const wall = Date.now() - wallStart;
  expect(typed.isError, typed.text).toBeFalsy();
  // Overlapping, not queued: well under the time of running them one after the other.
  expect(wall, `A alone ${aAlone}ms, B alone ${bAlone}ms, together ${wall}ms`).toBeLessThan((aAlone + bAlone) * 0.85);

  // No cross-talk: each page only saw its own agent.
  expect(await evalIn(A, tabA, "document.getElementById('name').value")).toBe(JSON.stringify(long));
  expect(await evalIn(A, tabA, "document.getElementById('count').textContent")).toContain('Đếm: 0');
  expect(await evalIn(B, tabB, "document.getElementById('name').value")).toBe('""');
  expect(await evalIn(B, tabB, "document.getElementById('count').textContent")).toContain('Đếm: 8');
});

test('calls on the same tab run one after another in the order they were sent', async () => {
  const snap = (await call('browser_snapshot', {}, A)).text;
  const field = refOf(snap, 'Họ tên', 'textbox');
  const finished: string[] = [];
  const mark = (name: string) => (r: { isError?: boolean; text: string }) => {
    expect(r.isError, r.text).toBeFalsy();
    finished.push(name);
  };
  const p1 = call('browser_type', { ref: field, text: 'A'.repeat(30), slowly: true }, A).then(mark('first'));
  await sleep(200);
  const p2 = call('browser_type', { ref: field, text: 'B'.repeat(10), slowly: true, clear: false }, A).then(mark('second'));
  await sleep(200);
  const p3 = call('browser_type', { ref: field, text: 'C'.repeat(5), clear: false }, A).then(mark('third'));
  await Promise.all([p1, p2, p3]);
  expect(finished).toEqual(['first', 'second', 'third']);
  // Interleaved input would scramble the letters.
  expect(await evalIn(A, tabA, "document.getElementById('name').value")).toBe(JSON.stringify('A'.repeat(30) + 'B'.repeat(10) + 'C'.repeat(5)));

  // Concurrent clicks on one tab are all applied exactly once.
  const inc = refOf((await call('browser_snapshot', {}, A)).text, 'Tăng', 'button');
  const results = await Promise.all([1, 2, 3, 4].map(() => call('browser_click', { ref: inc }, A)));
  results.forEach((r) => expect(r.isError, r.text).toBeFalsy());
  expect(await evalIn(A, tabA, "document.getElementById('count').textContent")).toContain('Đếm: 4');
});

test('Stop aborts running and queued calls on every tab, then work resumes', async () => {
  const running = [
    call('browser_wait_for', { text: 'never-on-this-page', timeout: 45 }, A),
    call('browser_wait_for', { text: 'never-on-this-page', timeout: 45 }, B),
  ];
  await sleep(400);
  const queued = call('browser_snapshot', {}, A); // waits behind A's long wait
  await sleep(1200);
  const popup = await popupSwitch();
  const stoppedAt = Date.now();
  await popup.toggle();
  const results = await Promise.all([...running, queued]);
  expect(Date.now() - stoppedAt).toBeLessThan(10_000);
  for (const r of results) {
    expect(r.isError).toBe(true);
    expect(r.text).toContain('pressed Stop');
  }
  // While paused nothing runs, whichever agent asks.
  expect((await call('browser_snapshot', {}, B)).isError).toBe(true);
  await popup.toggle();
  await sleep(300);
  const [ra, rb] = await Promise.all([call('browser_snapshot', {}, A), call('browser_snapshot', {}, B)]);
  expect(ra.isError, ra.text).toBeFalsy();
  expect(rb.isError, rb.text).toBeFalsy();
  await popup.close();
});

test.describe('new tools', () => {
  const T = 'tools-agent';
  let tab: number;

  test.beforeAll(async () => {
    const r = await call('browser_tabs', { action: 'new', url: `${SITE_A}/data.html` }, T);
    expect(r.isError, r.text).toBeFalsy();
    tab = tabIdOf(r.text);
  });

  test('browser_find returns refs for text, including inside iframes', async () => {
    let r = await call('browser_find', { text: 'giá' }, T);
    expect(r.text).toContain(`Tab ${tab} (${T})`);
    expect(r.text).toMatch(/\d+ match\(es\) for "giá"/);
    expect(r.text).toContain('Bảng giá');
    r = await call('browser_find', { text: 'Mã khuyến mãi' }, T);
    expect(r.text).toMatch(/\[ref=f\d+e\d+\] \(iframe f\d+\)/);
    const frameRef = /\[ref=(f\d+e\d+)\]/.exec(r.text)![1];
    expect((await call('browser_get_text', { ref: frameRef }, T)).text).toContain('Mã khuyến mãi ẩn trong iframe');
    expect((await call('browser_find', { text: 'GIÁ', caseSensitive: true }, T)).text).toContain('No visible text');
    expect((await call('browser_find', { text: 'không-có-chuỗi-này' }, T)).text).toContain('No visible text matches');
  });

  test('browser_extract returns links, tables, headings, forms and metadata as JSON', async () => {
    const r = await call('browser_extract', {}, T);
    expect(r.isError, r.text).toBeFalsy();
    const data = JSON.parse(r.text.slice(r.text.indexOf('{')));
    expect(data.meta).toMatchObject({ title: 'Data Page', description: 'Mô tả trang dữ liệu', canonical: `${SITE_A}/data.html`, 'og:title': 'OG Dữ liệu', lang: 'vi' });
    expect(data.headings).toEqual(expect.arrayContaining([expect.objectContaining({ level: 1, text: 'Bảng giá' })]));
    expect(data.links).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Về trang chủ', href: `${SITE_A}/index.html` })]));
    expect(data.links.some((l: { frame?: string; text: string }) => l.frame && l.text === 'Liên kết trong khung')).toBe(true);
    expect(data.tables[0]).toMatchObject({ caption: 'Giá trái cây', headers: ['Tên', 'Giá'], rows: [['Táo', '10'], ['Cam', '20']] });
    const form = data.forms.find((f: { name?: string }) => f.name === 'order');
    expect(form.fields.map((f: { name?: string }) => f.name)).toEqual(['email', 'size', 'gift']);
    expect(form.fields[0]).toMatchObject({ type: 'email', required: true });
    expect(form.fields[1].options).toEqual(['S', 'M']);

    const only = await call('browser_extract', { what: ['headings'], maxItems: 1 }, T);
    const slim = JSON.parse(only.text.slice(only.text.indexOf('{')));
    expect(Object.keys(slim)).toEqual(['headings']);
    expect(slim.headings).toHaveLength(1);

    const snap = (await call('browser_snapshot', {}, T)).text;
    const scoped = await call('browser_extract', { what: ['links'], ref: refOf(snap, 'Về trang chủ', 'link') }, T);
    expect(JSON.parse(scoped.text.slice(scoped.text.indexOf('{'))).links).toHaveLength(1);
  });

  test('browser_wait_for understands selectors and network idle', async () => {
    await call('browser_navigate', { action: 'reload' }, T);
    let r = await call('browser_wait_for', { selector: '#late', timeout: 8 }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('selector #late is on the page');
    expect(r.text).toContain('Đã tải xong');
    expect((await call('browser_wait_for', { selectorGone: '#no-such-thing' }, T)).isError).toBeFalsy();
    r = await call('browser_wait_for', { selector: '#never-here', timeout: 1 }, T);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Timed out');

    await call('browser_navigate', { action: 'reload' }, T);
    r = await call('browser_wait_for', { networkIdle: true, timeout: 10 }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('network is idle');
    expect(await evalIn(T, tab, 'window.__done === true')).toBe('true');
  });

  test('browser_select_text and browser_clipboard copy and paste per agent', async () => {
    let r = await call('browser_select_text', { text: 'Câu cần chọn' }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('selected 12 character(s)');
    r = await call('browser_clipboard', { action: 'copy' }, T);
    expect(r.text).toContain('copied 12 character(s)');
    const snap = (await call('browser_snapshot', {}, T)).text;
    r = await call('browser_clipboard', { action: 'paste', ref: refOf(snap, 'Dán vào đây', 'textbox') }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(await evalIn(T, tab, "document.getElementById('paste-target').value")).toBe('"Câu cần chọn"');
    expect((await call('browser_clipboard', { action: 'read' }, T)).text).toContain('Câu cần chọn');
    // Another agent's clipboard is separate.
    expect((await call('browser_clipboard', { action: 'read', tabId: tab }, 'agent-other')).text).toContain('holds 0 character(s)');
    r = await call('browser_select_text', { text: 'không-có-chuỗi-này' }, T);
    expect(r.isError).toBe(true);
  });

  test('browser_pdf renders the page', async () => {
    let r = await call('browser_pdf', { returnBase64: true }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('JVBERi0'); // base64 of "%PDF-"
    r = await call('browser_pdf', { filename: 'helmsman-e2e.pdf' }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('Saved the page as PDF');
    const saved = /Downloaded to (.+\.pdf)/.exec(r.text)?.[1];
    expect(saved, r.text).toBeTruthy();
    expect(fs.readFileSync(saved!).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('browser_emulate changes one tab and resets', async () => {
    const probe = "JSON.stringify([innerWidth, matchMedia('(pointer: coarse)').matches, navigator.userAgent.includes('iPhone'), matchMedia('(prefers-color-scheme: dark)').matches, navigator.onLine])";
    const normal = JSON.parse(JSON.parse(await evalIn(T, tab, probe)));
    let r = await call('browser_emulate', { device: 'iphone', colorScheme: 'dark' }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('viewport: 390x844 mobile');
    expect(JSON.parse(JSON.parse(await evalIn(T, tab, probe)))).toEqual([390, true, true, true, true]);
    // Other tabs are untouched.
    expect(JSON.parse(JSON.parse(await evalIn(B, tabB, probe)))[0]).toBe(normal[0]);
    r = await call('browser_emulate', { offline: true }, T);
    expect(r.text).toContain('network: offline');
    expect(JSON.parse(JSON.parse(await evalIn(T, tab, probe)))[4]).toBe(false);
    r = await call('browser_emulate', {}, T);
    expect(r.text).toContain('viewport: 390x844 mobile');
    r = await call('browser_emulate', { reset: true }, T);
    expect(r.text).toContain('Emulation reset');
    expect(JSON.parse(JSON.parse(await evalIn(T, tab, probe)))).toEqual(normal);
    expect((await call('browser_emulate', { device: 'tv' }, T)).isError).toBe(true);
  });

  test('browser_cookies reads, sets and deletes cookies of the tab site', async () => {
    let r = await call('browser_cookies', { action: 'set', name: 'cma_test', value: 'abc123' }, T);
    expect(r.isError, r.text).toBeFalsy();
    r = await call('browser_cookies', { name: 'cma_test' }, T);
    expect(r.text).toContain('cma_test=abc123');
    expect(await evalIn(T, tab, 'document.cookie')).toContain('cma_test=abc123');
    r = await call('browser_cookies', { action: 'delete', name: 'cma_test' }, T);
    expect(r.text).toContain('Deleted cookie cma_test');
    expect((await call('browser_cookies', { name: 'cma_test' }, T)).text).toContain('No cookies match');
    r = await call('browser_cookies', { action: 'set', name: 'cma_dom', value: 'x1', url: SITE_A }, T);
    expect(r.isError, r.text).toBeFalsy();
    expect((await call('browser_cookies', { url: SITE_A }, T)).text).toContain('cma_dom=x1');
    await call('browser_cookies', { action: 'delete', name: 'cma_dom', url: SITE_A }, T);
  });

  test('browser_history finds visited pages', async () => {
    await expect
      .poll(async () => (await call('browser_history', { text: 'Data Page' }, T)).text, { timeout: 15_000 })
      .toContain(`${SITE_A}/data.html`);
    expect((await call('browser_history', { text: 'zzzz-not-visited-zzzz' }, T)).text).toContain('No history entries');
  });

  test('browser_windows lists, opens and closes windows', async () => {
    let r = await call('browser_windows', {}, T);
    expect(r.text).toMatch(/Window \d+: normal/);
    r = await call('browser_windows', { action: 'new', url: `${SITE_A}/same.html` }, T);
    expect(r.isError, r.text).toBeFalsy();
    const windowId = Number(/Opened window (\d+) with tab (\d+)/.exec(r.text)![1]);
    expect(r.text).toContain(`(${T})`);
    expect((await call('browser_windows', {}, T)).text).toContain(`Window ${windowId}:`);
    r = await call('browser_windows', { action: 'close', windowId }, T);
    expect(r.text).toContain(`Closed window ${windowId}`);
    expect((await call('browser_windows', { action: 'close' }, T)).isError).toBe(true);
    // The default tab went away with its window; the next call gets a fresh one.
    await call('browser_tabs', { action: 'select', tabId: tab }, T);
  });
});
