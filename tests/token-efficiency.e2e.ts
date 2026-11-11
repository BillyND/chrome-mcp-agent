// End-to-end: snapshot diffs and scoped reads, the output budget, tool profiles, the secrets vault
// and saved workflows, all through MCP calls on a real Chromium with the extension.

import { expect, test, type Page } from '@playwright/test';
import { cloudCall, unwrapUntrusted } from './fixtures/helpers';
import { StdioMcpClient } from './fixtures/mcp-stdio-client';
import { call as sealedCall, DEVICE, GATEWAY, refOf, SITE_A, startHarness, stopHarness, type Harness } from './support/harness';

/** Tool calls as seen without the untrusted-content envelope (covered by safety.e2e.ts): these tests are about the payload. */
const call: typeof sealedCall = async (...args) => {
  const r = await sealedCall(...args);
  return { ...r, text: unwrapUntrusted(r.text) };
};

/** Length of what the tool returned, not counting the untrusted-content envelope every result is sealed in. */
const len = (text: string) => unwrapUntrusted(text).length;

let h: Harness;
let page: Page;
const HOME = `${SITE_A}/index.html`;

test.beforeAll(async () => {
  h = await startHarness();
  page = h.ctx.pages()[0];
  const tabs = await call('browser_tabs', { action: 'list' });
  const tabId = Number(/\[(\d+)\] Fixture Home/.exec(tabs.text)?.[1]);
  await call('browser_tabs', { action: 'select', tabId });
});

test.afterAll(async () => {
  await stopHarness(h);
});

test.describe.configure({ mode: 'serial' });

/** Fresh page, and a clean snapshot baseline (navigation clears it). */
async function home() {
  const r = await call('browser_navigate', { url: HOME });
  expect(r.isError, r.text).toBeFalsy();
  return r;
}

const snapshotOf = (args: Record<string, unknown> = {}) => call('browser_snapshot', args);

async function rpc(method: string, params: Record<string, unknown> = {}, query = '') {
  const res = await fetch(`${GATEWAY}/dev/mcp?device=${DEVICE}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  return JSON.parse((raw.split('\n').find((l) => l.startsWith('data: ')) ?? raw).replace(/^data: /, ''));
}

test.describe('snapshot diffing', () => {
  test('an action after a snapshot returns only the changed lines, far shorter than the full snapshot', async () => {
    await home();
    const full = await snapshotOf();
    expect(full.text).toContain('Page snapshot:');
    expect(full.text).not.toContain('Snapshot diff');

    const click = await call('browser_click', { ref: refOf(full.text, 'Tăng', 'button') });
    expect(click.isError, click.text).toBeFalsy();
    expect(click.text).toContain('Snapshot diff');
    expect(click.text).toMatch(/\+0 −0 ~\d+ lines; unchanged: \d+/);
    expect(click.text).toContain('~ - text: Đếm: 1');
    expect(click.text).not.toContain('heading "Trang thử nghiệm"');
    expect(len(click.text)).toBeLessThan(len(full.text) * 0.35);

    // Refs from the old snapshot are still valid, and each further action diffs against the latest state.
    const again = await call('browser_click', { ref: refOf(full.text, 'Tăng', 'button') });
    expect(again.text).toContain('~ - text: Đếm: 2');
    expect(again.text).not.toContain('~ - text: Đếm: 1');
  });

  test('mode diff reports no changes, full still works, and new elements show as added', async () => {
    await home();
    const full = await snapshotOf();
    const same = await snapshotOf({ mode: 'diff' });
    expect(same.text).toContain('Snapshot diff (no changes');
    expect(len(same.text)).toBeLessThan(len(full.text) / 4);
    const forced = await snapshotOf({ mode: 'full' });
    expect(forced.text).toContain('heading "Trang thử nghiệm"');

    // Add and remove DOM from outside: the diff lists them.
    await page.evaluate(() => {
      document.getElementById('count')?.remove();
      const b = document.createElement('button');
      b.textContent = 'Nút mới';
      document.body.prepend(b);
    });
    const changed = await snapshotOf({ mode: 'diff' });
    expect(changed.text).toContain('+ - button "Nút mới"');
    expect(changed.text).toMatch(/^- - text: Đếm/m);
    expect(len(changed.text)).toBeLessThan(len(full.text) / 3);
  });

  test('navigation starts over with a full snapshot, which is then the new baseline', async () => {
    const first = await home();
    expect(first.text).toContain('heading "Trang thử nghiệm"');
    expect(first.text).not.toContain('Snapshot diff');
    const next = await call('browser_navigate', { url: `${SITE_A}/same.html` });
    expect(next.text).not.toContain('Snapshot diff'); // the old page's lines were dropped
    expect(next.text).toContain('Nút cùng nguồn');
    // A one-line page: the baseline exists, but a diff would not be smaller, so the full snapshot is the answer.
    const again = await snapshotOf({ mode: 'diff' });
    expect(again.text).toContain('the diff would not be smaller');
    expect(again.text).toContain('Nút cùng nguồn');
  });

  test('each agent and each tab keeps its own baseline', async () => {
    await home();
    await snapshotOf();
    // Another agent has not seen this tab yet: asking for a diff gives it the full snapshot.
    const tabs = await call('browser_tabs', { action: 'list' });
    const tabId = Number(/\[(\d+)\] Fixture Home/.exec(tabs.text)?.[1]);
    const other = await call('browser_snapshot', { mode: 'diff', tabId }, 'other-agent');
    expect(other.text).toContain('no earlier snapshot');
    const mine = await snapshotOf({ mode: 'diff' });
    expect(mine.text).toContain('Snapshot diff');
  });
});

test.describe('scoped and compact reads', () => {
  test('a ref inside a cross-origin iframe reads just that subtree', async () => {
    await home();
    const full = await snapshotOf();
    const buttonRef = refOf(full.text, 'Gửi iframe', 'button');
    expect(buttonRef).toMatch(/^f\d+e\d+$/);
    const one = await snapshotOf({ ref: buttonRef });
    expect(one.text).toContain('button "Gửi iframe"');
    expect(one.text).not.toContain('Trang thử nghiệm');
    expect(one.text).not.toContain('Email trong iframe');

    // The iframe element itself: its whole content, nothing of the host page.
    const frameRef = refOf(full.text, 'Khung khác nguồn', 'iframe');
    const frame = await snapshotOf({ ref: frameRef });
    expect(frame.text).toContain('Email trong iframe');
    expect(frame.text).toContain('Nút lồng'); // the nested frame inside it
    expect(frame.text).not.toContain('Trang thử nghiệm');
    expect(frame.text).not.toContain('Tăng');
    expect(len(frame.text)).toBeLessThan(len(full.text));

    // The scoped view is its own baseline: a diff of it is a diff of the subtree.
    const frameDiff = await snapshotOf({ ref: frameRef, mode: 'diff' });
    expect(frameDiff.text).toContain('Snapshot diff (no changes');
  });

  test('a ref that is gone fails with a clear message', async () => {
    await home();
    const r = await snapshotOf({ ref: 'e99999' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no longer on the page|Take a new browser_snapshot/);
  });

  test('interactiveOnly lists actions and headings, not prose', async () => {
    await home();
    const full = await snapshotOf();
    const compact = await snapshotOf({ interactiveOnly: true });
    expect(compact.text).toContain('button "Tăng"');
    expect(compact.text).toContain('heading "Trang thử nghiệm"');
    expect(compact.text).toContain('textbox "Họ tên"');
    expect(compact.text).toContain('Email trong iframe'); // frames are still entered
    expect(compact.text).not.toContain('text: Đếm');
    expect(compact.text).not.toContain('text: Đáy trang');
    expect(len(compact.text)).toBeLessThan(len(full.text)); // the fixture is mostly controls, so the saving is modest here
    expect(compact.text.split('\n').length).toBeLessThan(full.text.split('\n').length);
    // Refs in the compact view work.
    const r = await call('browser_click', { ref: refOf(compact.text, 'Tăng', 'button') });
    expect(r.text).toContain('Đếm: 1');
  });

  test('depth limits nesting and says so', async () => {
    await home();
    const full = await snapshotOf();
    const shallow = await snapshotOf({ depth: 0 });
    expect(shallow.text).toContain('deeper content hidden by depth=0');
    expect(shallow.text).not.toContain('Email trong iframe');
    expect(len(shallow.text)).toBeLessThan(len(full.text));
    const deeper = await snapshotOf({ depth: 8 });
    expect(deeper.text).toContain('Email trong iframe');
  });
});

test.describe('output budget', () => {
  test('a cut snapshot ends with a note and browser_read_more pages the rest', async () => {
    await home();
    const whole = await snapshotOf();
    const body = unwrapUntrusted(whole.text).split('Page snapshot:\n')[1];
    const cut = await snapshotOf({ maxChars: 1000 });
    expect(len(cut.text)).toBeLessThanOrEqual(1000);
    const note = /browser_read_more \{"handle":"(h\d+)","offset":(\d+)\}/.exec(cut.text);
    expect(note, cut.text).toBeTruthy();
    const handle = note![1];
    let offset = Number(note![2]);
    let rebuilt = unwrapUntrusted(cut.text).split('Page snapshot:\n')[1].split('\n… [truncated')[0];

    for (let i = 0; i < 40 && offset < body.length; i++) {
      const more = await call('browser_read_more', { handle, offset, maxChars: 1000 });
      expect(more.isError, more.text).toBeFalsy();
      expect(len(more.text)).toBeLessThanOrEqual(1000);
      const chunk = unwrapUntrusted(more.text);
      const range = /^Characters (\d+)-(\d+) of (\d+)/.exec(chunk)!;
      expect(Number(range[1])).toBe(offset);
      rebuilt += chunk.slice(chunk.indexOf('\n') + 1).split('\n… [truncated')[0].replace(/\n\[end of text\]$/, '');
      offset = Number(range[2]);
    }
    // Same text as the uncut snapshot, modulo the newline that separated the chunks.
    expect(rebuilt.replace(/\n/g, '')).toBe(body.replace(/\n/g, ''));
  });

  test('every tool output stays within the global budget, and the handle keeps the rest', async () => {
    await home();
    const r = await call('browser_evaluate', { script: 'return "x".repeat(150000)' });
    expect(len(r.text)).toBeLessThanOrEqual(40_000);
    expect(r.text).toContain('browser_read_more');
    const handle = /"handle":"(h\d+)"/.exec(r.text)![1];
    const tail = await call('browser_read_more', { handle, offset: 140_000 });
    expect(tail.text).toContain('xxxx');
    expect(tail.text).toContain('[end of text]');

    const text = await call('browser_get_text', { maxChars: 1500 });
    expect(len(text.text)).toBeLessThanOrEqual(1500);
  });

  test('unknown handles and other agents cannot read a handle', async () => {
    await home();
    const r = await call('browser_evaluate', { script: 'return "y".repeat(60000)' });
    const handle = /"handle":"(h\d+)"/.exec(r.text)![1];
    const stranger = await call('browser_read_more', { handle, offset: 0 }, 'someone-else');
    expect(stranger.isError).toBe(true);
    expect(stranger.text).toContain('Unknown or expired handle');
    const missing = await call('browser_read_more', { handle: 'h99999' });
    expect(missing.isError).toBe(true);
  });
});

test.describe('tool profiles', () => {
  test('cloud: core is a short list, full (the default) has everything', async () => {
    const full = (await rpc('tools/list')).result.tools.map((t: { name: string }) => t.name);
    const core = (await rpc('tools/list', {}, '&profile=core')).result.tools.map((t: { name: string }) => t.name);
    const nonsense = (await rpc('tools/list', {}, '&profile=banana')).result.tools.map((t: { name: string }) => t.name);
    expect(full.length).toBeGreaterThan(30);
    expect(full).toContain('browser_workflow');
    expect(nonsense).toEqual(full);
    expect(core.length).toBeLessThanOrEqual(14);
    expect(core.length).toBeGreaterThanOrEqual(10);
    expect(core).toContain('browser_snapshot');
    expect(core).toContain('browser_read_more');
    expect(core).not.toContain('browser_cookies');
    // A core server still runs its tools.
    const via = await cloudCall(GATEWAY, DEVICE, 'browser_tabs', { action: 'list' });
    expect(via.isError).toBeFalsy();
  });

  test('local: HELMSMAN_PROFILE=core advertises the short list', async () => {
    const port = Number(process.env.HELMSMAN_PORT ?? 47821) + 3;
    process.env.HELMSMAN_PROFILE = 'core';
    const core = new StdioMcpClient('profile-core', port);
    delete process.env.HELMSMAN_PROFILE;
    try {
      await core.initialize();
      const names = (await core.listTools()).map((t) => t.name);
      expect(names.length).toBeLessThanOrEqual(14);
      expect(names).toContain('browser_snapshot');
      expect(names).not.toContain('browser_cookies');
    } finally {
      await core.close();
    }
  });
});

const SECRET = 's3cr3t-Pa55"word\\!';

test.describe('secrets vault', () => {
  test.beforeAll(async () => {
    await h.sw.evaluate((value) => chrome.storage.local.set({ secrets: { E2E_PASSWORD: value } }), SECRET);
  });
  test.afterAll(async () => {
    await h.sw.evaluate(() => chrome.storage.local.remove('secrets'));
  });

  test('the model types a secret it never sees: the page gets it, no output contains it', async () => {
    await home();
    const outputs: string[] = [];
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await call(name, args);
      outputs.push(r.text);
      return r;
    };

    const list = await run('browser_secrets_list');
    expect(list.text).toContain('E2E_PASSWORD');
    expect(list.text).not.toContain('s3cr3t');

    const snap = await run('browser_snapshot');
    const typed = await run('browser_type', { element: 'Họ tên', ref: refOf(snap.text, 'Họ tên', 'textbox'), text: '{{secret:E2E_PASSWORD}}' });
    expect(typed.isError, typed.text).toBeFalsy();
    expect(typed.text).toContain('{{secret:E2E_PASSWORD}}');

    // The page really received the value...
    expect(await page.inputValue('#name')).toBe(SECRET);

    // ...and nothing the model can call shows it.
    const view = await run('browser_snapshot', { mode: 'full' });
    expect(view.text).toContain('value="{{secret:E2E_PASSWORD}}"');
    await run('browser_snapshot', { interactiveOnly: true });
    const ev = await run('browser_evaluate', { script: 'return document.getElementById("name").value' });
    expect(ev.text).toContain('{{secret:E2E_PASSWORD}}');
    await run('browser_evaluate', { script: 'return [document.getElementById("name").value, location.href, JSON.stringify(document.getElementById("name").value)]' });
    await run('browser_get_text');
    await run('browser_find', { text: 'Họ tên' });
    await run('browser_extract', { what: ['forms'] });
    await run('browser_evaluate', { script: 'console.log("typed:", document.getElementById("name").value); console.error(document.getElementById("name").value); return 1' });
    await run('browser_console_messages');
    await run('browser_network_requests');
    await run('browser_click', { ref: refOf(snap.text, 'Tăng', 'button') });
    // A page that echoes the secret into the URL does not leak it through the header either.
    await page.evaluate((v) => history.replaceState(null, '', `/index.html?pw=${encodeURIComponent(v)}`), SECRET);
    await run('browser_snapshot');

    for (const out of outputs) {
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain('s3cr3t-Pa55');
      expect(out).not.toContain(encodeURIComponent(SECRET));
      expect(out).not.toContain(JSON.stringify(SECRET).slice(1, -1));
    }
    expect(outputs.some((o) => o.includes('{{secret:E2E_PASSWORD}}'))).toBe(true);
  });

  test('browser_fill_form takes secrets too, without echoing them', async () => {
    await home();
    const snap = await snapshotOf();
    const r = await call('browser_fill_form', { fields: [{ ref: refOf(snap.text, 'Họ tên', 'textbox'), value: 'user-{{secret:E2E_PASSWORD}}' }] });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).not.toContain('s3cr3t');
    expect(await page.inputValue('#name'), r.text).toBe(`user-${SECRET}`);
  });

  test('secrets are refused in URLs, scripts and every other tool; unknown names say what exists', async () => {
    await home();
    for (const [tool, args] of [
      ['browser_navigate', { url: `${SITE_A}/index.html?pw={{secret:E2E_PASSWORD}}` }],
      ['browser_evaluate', { script: 'return "{{secret:E2E_PASSWORD}}"' }],
      ['browser_cookies', { action: 'set', name: 'a', value: '{{secret:E2E_PASSWORD}}' }],
      ['browser_clipboard', { action: 'copy', text: '{{secret:E2E_PASSWORD}}' }],
    ] as const) {
      const r = await call(tool, args);
      expect(r.isError, tool).toBe(true);
      expect(r.text).toContain('can only be used in browser_type and browser_fill_form');
    }
    expect(await page.evaluate(() => location.search)).toBe('');

    const snap = await snapshotOf();
    const unknown = await call('browser_type', { ref: refOf(snap.text, 'Họ tên', 'textbox'), text: '{{secret:NOPE}}' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('Unknown secret "NOPE"');
    expect(unknown.text).toContain('E2E_PASSWORD');
    expect(await page.inputValue('#name')).toBe('');
  });

  test('the popup lists names, never values, and saves and deletes secrets', async () => {
    const popup = await h.ctx.newPage();
    await popup.goto(`chrome-extension://${new URL(h.sw.url()).host}/popup.html`);
    await popup.locator('#secrets button[aria-expanded]').click();
    await expect(popup.locator('#secrets')).toContainText('E2E_PASSWORD');
    await expect(popup.locator('#secrets')).not.toContainText('s3cr3t');
    await popup.fill('#secret-name', 'API_KEY');
    await popup.fill('#secret-value', 'k-12345');
    await popup.click('#secret-save');
    await expect(popup.locator('#secrets')).toContainText('API_KEY');
    expect(await h.sw.evaluate(async () => Object.keys((await chrome.storage.local.get('secrets')).secrets).sort())).toEqual(['API_KEY', 'E2E_PASSWORD']);
    expect((await call('browser_secrets_list')).text).toContain('API_KEY');
    // Too short a value is refused.
    await popup.fill('#secret-name', 'TINY');
    await popup.fill('#secret-value', 'ab');
    await popup.click('#secret-save');
    await expect(popup.locator('#secrets')).not.toContainText('TINY');
    await popup.getByRole('button', { name: /Delete API_KEY|Xóa API_KEY/ }).click();
    await expect(popup.locator('#secrets')).not.toContainText('API_KEY');
    await popup.close();
  });
});

test.describe('saved workflows', () => {
  const NAME = 'điền form';

  test('record three steps, reload, replay with a parameter: same result', async () => {
    await home();
    expect((await call('browser_workflow', { action: 'list' })).text).toBe('{"workflows":[]}');

    const start = await call('browser_workflow', { action: 'start_recording', name: NAME, description: 'Tăng, nhập tên và chọn thành phố' });
    expect(start.isError, start.text).toBeFalsy();
    const dup = await call('browser_workflow', { action: 'start_recording', name: 'other' });
    expect(dup.isError).toBe(true);

    const snap = await snapshotOf();
    expect((await call('browser_click', { ref: refOf(snap.text, 'Tăng', 'button') })).isError).toBeFalsy();
    expect((await call('browser_type', { ref: refOf(snap.text, 'Họ tên', 'textbox'), text: 'An' })).isError).toBeFalsy();
    expect((await call('browser_select_option', { ref: refOf(snap.text, 'Thành phố', 'combobox'), values: ['Hà Nội'] })).isError).toBeFalsy();
    // A failing call and a read are not recorded.
    expect((await call('browser_click', { ref: 'e99999' })).isError).toBe(true);
    await snapshotOf();

    const stop = await call('browser_workflow', { action: 'stop_recording', params: { person: 'An' } });
    expect(stop.isError, stop.text).toBeFalsy();
    expect(stop.text).toContain('3 step(s)');
    expect(stop.text).toContain('parameter(s) person');

    const detail = JSON.parse((await call('browser_workflow', { action: 'list', name: NAME })).text);
    expect(detail.params).toEqual({ person: 'An' });
    expect(detail.steps).toEqual(['browser_click button "Tăng"', 'browser_type textbox "Họ tên" "{{param:person}}"', 'browser_select_option combobox "Thành phố"']);
    const listed = JSON.parse((await call('browser_workflow', { action: 'list' })).text);
    expect(listed.workflows).toEqual([{ name: NAME, description: 'Tăng, nhập tên và chọn thành phố', params: { person: 'An' }, steps: 3 }]);

    // The recording is on disk as locators, not refs.
    const stored = JSON.stringify(await h.sw.evaluate(async () => (await chrome.storage.local.get('workflows')).workflows));
    expect(stored).toContain('"role":"button"');
    expect(stored).not.toMatch(/"ref":"e\d+"/);

    const original = {
      count: await page.textContent('#count'),
      name: await page.inputValue('#name'),
      city: await page.inputValue('#city'),
    };
    expect(original).toEqual({ count: 'Đếm: 1', name: 'An', city: 'hn' });

    // Reload: refs are new, the page is back to its start. Replay with another value.
    await page.reload();
    await home();
    const ran = await call('browser_workflow', { action: 'run', name: NAME, params: { person: 'Bình' } });
    expect(ran.isError, ran.text).toBeFalsy();
    expect(ran.text).toContain('3 step(s) ran');
    expect({
      count: await page.textContent('#count'),
      name: await page.inputValue('#name'),
      city: await page.inputValue('#city'),
    }).toEqual({ count: 'Đếm: 1', name: 'Bình', city: 'hn' });

    // Without params the recorded value is used.
    await page.reload();
    await home();
    expect((await call('browser_workflow', { action: 'run', name: NAME })).isError).toBeFalsy();
    expect(await page.inputValue('#name')).toBe('An');
  });

  test('a replay stops at the first failing step and says which and why', async () => {
    await call('browser_navigate', { url: `${SITE_A}/same.html` }); // a page without the recorded buttons
    const r = await call('browser_workflow', { action: 'run', name: NAME });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(`Workflow "${NAME}" stopped at step 1 of 3`);
    expect(r.text).toContain('browser_click button "Tăng"');
    expect(r.text).toContain('Could not find button "Tăng"');
    expect(r.text).toContain('No step completed');
  });

  test('bad calls are explained: unknown workflow, unknown parameter, nothing recorded, not recording', async () => {
    await home();
    expect((await call('browser_workflow', { action: 'run', name: 'nope' })).text).toContain('No saved workflow named "nope"');
    const badParam = await call('browser_workflow', { action: 'run', name: NAME, params: { wrong: '1' } });
    expect(badParam.isError).toBe(true);
    expect(badParam.text).toContain('Unknown parameter "wrong"');
    expect(badParam.text).toContain('person');
    expect((await call('browser_workflow', { action: 'stop_recording' })).text).toContain('Not recording');
    expect((await call('browser_workflow', { action: 'start_recording', name: '   ' })).isError).toBe(true);
    await call('browser_workflow', { action: 'start_recording', name: 'empty' });
    const empty = await call('browser_workflow', { action: 'stop_recording' });
    expect(empty.isError).toBe(true);
    expect(empty.text).toContain('Nothing was recorded');
    // A parameter that matches nothing is refused and recording stays on.
    await call('browser_workflow', { action: 'start_recording', name: 'tmp' });
    const snap = await snapshotOf();
    await call('browser_click', { ref: refOf(snap.text, 'Tăng', 'button') });
    const unused = await call('browser_workflow', { action: 'stop_recording', params: { ghost: 'zzz' } });
    expect(unused.isError).toBe(true);
    expect(unused.text).toContain('"ghost"');
    expect((await call('browser_workflow', { action: 'stop_recording' })).isError).toBeFalsy();
    expect((await call('browser_workflow', { action: 'delete', name: 'tmp' })).text).toContain('Deleted');
  });

  test('steps inside a cross-origin iframe are found again by their frame and name', async () => {
    await home();
    await call('browser_workflow', { action: 'start_recording', name: 'iframe form' });
    const snap = await snapshotOf();
    await call('browser_type', { ref: refOf(snap.text, 'Email trong iframe', 'textbox'), text: 'a@b.vn' });
    const sent = await call('browser_click', { ref: refOf(snap.text, 'Gửi iframe', 'button') });
    expect(sent.text).toContain('Đã gửi: a@b.vn');
    await call('browser_workflow', { action: 'stop_recording', params: { email: 'a@b.vn' } });

    await home();
    const ran = await call('browser_workflow', { action: 'run', name: 'iframe form', params: { email: 'zed@c.vn' } });
    expect(ran.isError, ran.text).toBeFalsy();
    expect(ran.text).toContain('Đã gửi: zed@c.vn');
    const frame = page.frames().find((f) => f.url().includes('cross.html'))!;
    expect(await frame.textContent('#out')).toBe('Đã gửi: zed@c.vn');
  });

  test('saved workflows are offered as MCP prompts, with a ready-to-follow instruction', async () => {
    const list = (await rpc('prompts/list')).result.prompts as Array<{ name: string; description: string; arguments: Array<{ name: string }> }>;
    const mine = list.find((p) => p.name === NAME)!;
    expect(mine).toBeTruthy();
    expect(mine.description).toContain('Tăng');
    expect(mine.arguments.map((a) => a.name)).toEqual(['person']);

    const got = (await rpc('prompts/get', { name: NAME, arguments: { person: 'Cường' } })).result;
    const text = got.messages[0].content.text as string;
    expect(text).toContain('browser_workflow');
    expect(text).toContain(JSON.stringify({ action: 'run', name: NAME, params: { person: 'Cường' } }));
    expect(text).toContain('browser_click button "Tăng"');
    expect((await rpc('prompts/get', { name: 'missing one' })).error).toBeTruthy();
  });

  test('delete removes a workflow', async () => {
    expect((await call('browser_workflow', { action: 'delete', name: NAME })).text).toContain('Deleted');
    expect((await call('browser_workflow', { action: 'delete', name: 'iframe form' })).isError).toBeFalsy();
    expect((await call('browser_workflow', { action: 'list' })).text).toBe('{"workflows":[]}');
    expect((await rpc('prompts/list')).result.prompts).toEqual([]);
  });
});
