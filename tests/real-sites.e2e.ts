// Real-site end-to-end: drives public websites (no login) through the MCP tools the way an AI agent
// would. Opt-in because it needs the internet and depends on third-party pages:
//
//   REAL_SITES=1 E2E_PORT=8815 E2E_FIXTURE_PORT=4700 HELMSMAN_PORT=47915 npx playwright test tests/real-sites.e2e.ts
//
// Skipped otherwise, so CI stays offline-safe. A site that cannot be reached from the machine skips its
// scenario with the reason instead of failing; every scenario retries once for flaky networks.
//
// Regression notes record real bugs these sites exposed in the extension (see plans/reports).

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import { call, refOf, startHarness, stopHarness, type Harness } from './support/harness';
import { FIXTURE_PORT } from './fixtures/server.mjs';
import { unwrapUntrusted } from './fixtures/helpers';

test.skip(process.env.REAL_SITES !== '1', 'real-site suite is opt-in: set REAL_SITES=1');
test.describe.configure({ retries: 1 });
test.setTimeout(180_000);

let h: Harness;

test.beforeAll(async () => {
  if (process.env.REAL_SITES !== '1') return;
  h = await startHarness();
  const tabs = await call('browser_tabs', { action: 'list' });
  const tabId = Number(/\[(\d+)\]/.exec(tabs.text)?.[1]);
  await call('browser_tabs', { action: 'select', tabId });
  // browser_evaluate asks the user per host; pre-allow it (stored as site rules "script:<host>") on the sites that use it.
  const hosts = ['en.wikipedia.org', 'httpbin.org', 'the-internet.herokuapp.com', 'localhost', 'react.dev', 'shoelace.style', 'docs.google.com', 'excalidraw.com'];
  await h.sw.evaluate((list) => chrome.storage.local.set({ siteRules: Object.fromEntries(list.map((host) => [`script:${host}`, 'allow'])) }), hosts);
});
test.afterAll(async () => {
  await stopHarness(h);
});

const NETWORK_ERROR = /ERR_(NAME_NOT_RESOLVED|CONNECTION|INTERNET|TIMED_OUT|TUNNEL|PROXY|SSL|CERT|ADDRESS|NETWORK)/;

/** Opens a URL in the agent's tab; skips the scenario (with the reason) when the site is unreachable from this machine. */
async function open(url: string) {
  const r = await call('browser_navigate', { url });
  if (r.isError && NETWORK_ERROR.test(r.text)) test.skip(true, `${new URL(url).host} unreachable from this machine: ${r.text.slice(0, 120)}`);
  expect(r.isError, r.text).toBeFalsy();
  return r;
}

const snapshot = async (args: Record<string, unknown> = {}) => (await call('browser_snapshot', args)).text;
const text = async (args: Record<string, unknown> = {}) => (await call('browser_get_text', args)).text;
/** Value a browser_evaluate script returned (JSON text after the "Tab N (AI) result:" header, envelope removed if present). */
const evalText = async (script: string, args: Record<string, unknown> = {}) => {
  const r = await call('browser_evaluate', { script, ...args });
  expect(r.isError, r.text).toBeFalsy();
  return unwrapUntrusted(r.text).replace(/^[\s\S]*?result:\s*/, '').trim();
};
const evalJson = async (script: string, args: Record<string, unknown> = {}) => JSON.parse(await evalText(script, args));
const pageUrl = async () => String(await evalJson('location.href'));

/** Polls a read-only tool until its text matches (pages settle asynchronously). */
async function until(read: () => Promise<string>, pattern: RegExp | string, timeout = 20_000) {
  await expect.poll(read, { timeout, intervals: [400, 800, 1500] }).toMatch(pattern);
}

test.describe('real sites', () => {
  test('wikipedia: type into search, submit, follow a link, find text, extract the infobox, scroll', async () => {
    await open('https://en.wikipedia.org/wiki/Main_Page');
    let snap = await snapshot({ interactiveOnly: true });
    const box = refOf(snap, 'Search Wikipedia', 'searchbox');
    await call('browser_type', { ref: box, text: 'Alan Turing', submit: true });
    await until(pageUrl, /wikipedia\.org\/(wiki\/Alan_Turing|w\/index\.php\?search=)/);

    // A search with an exact title match lands on the article; otherwise pick the first result.
    if (!/\/wiki\/Alan_Turing/.test(await pageUrl())) {
      snap = await snapshot({ interactiveOnly: true });
      await call('browser_click', { ref: refOf(snap, 'Alan Turing', 'link') });
    }
    await until(pageUrl, /\/wiki\/Alan_Turing/);

    // Find text, then follow the link behind it.
    const found = await call('browser_find', { text: 'Turing machine', maxResults: 5 });
    expect(found.text).toContain('Turing machine');
    const ref = /ref=(f?\d*e\d+)/.exec(found.text)?.[1];
    expect(ref, found.text).toBeTruthy();

    // The infobox is a table: its rows hold the facts.
    const tables = await call('browser_extract', { what: ['tables'], maxItems: 50 });
    expect(tables.text).toMatch(/Born/);
    expect(tables.text).toMatch(/Cambridge|Maida Vale|Wilmslow/);

    const links = await call('browser_find', { text: 'Enigma machine', maxResults: 3 });
    const enigma = /ref=(f?\d*e\d+)/.exec(links.text)?.[1];
    expect(enigma, links.text).toBeTruthy();
    await call('browser_click', { ref: enigma! });
    await until(pageUrl, /Enigma/);

    const scrolled = await call('browser_scroll', { direction: 'down', amount: 2500 });
    expect(scrolled.text).toMatch(/Now at \d+px/);
    expect(Number(/Now at (\d+)px/.exec(scrolled.text)![1])).toBeGreaterThan(1000);
    expect(await text()).toMatch(/Enigma/);
  });

  test('httpbin forms: fill_form (text, radio, checkboxes), submit and verify the echoed response', async () => {
    await open('https://httpbin.org/forms/post');
    const snap = await snapshot();
    const r = await call('browser_fill_form', {
      fields: [
        { ref: refOf(snap, 'Customer name', 'textbox'), value: 'Ada Lovelace' },
        { ref: refOf(snap, 'Telephone', 'textbox'), value: '+44 20 7946 0000' },
        { ref: refOf(snap, 'E-mail address', 'textbox'), value: 'ada@example.org' },
        { ref: refOf(snap, 'Medium', 'radio'), value: true },
        { ref: refOf(snap, 'Bacon', 'checkbox'), value: true },
        { ref: refOf(snap, 'Mushroom', 'checkbox'), value: true },
        { ref: refOf(snap, 'Delivery instructions', 'textbox'), value: 'Ring twice. Xin chào!' },
      ],
    });
    expect(r.isError, r.text).toBeFalsy();
    const clicked = await call('browser_click', { ref: refOf(snap, 'Submit order', 'button') });
    expect(clicked.isError, clicked.text).toBeFalsy();
    await until(pageUrl, /httpbin\.org\/post/);
    const body = await text();
    expect(body).toContain('"custname": "Ada Lovelace"');
    expect(body).toContain('"custtel": "+44 20 7946 0000"');
    expect(body).toContain('"custemail": "ada@example.org"');
    expect(body).toContain('"size": "medium"');
    expect(body).toMatch(/"topping": \[\s*"bacon",\s*"mushroom"\s*\]/);
    expect(body).toContain('Ring twice. Xin chào!');
  });

  test('MDN interactive example in a cross-origin iframe: edit the code, run it, read the output', async () => {
    // MDN frames its "Try it" editors from interactive-examples.mdn.mozilla.net; embed one the way an article does.
    const host = http.createServer((_, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<h1>Article</h1><iframe title="example" src="https://interactive-examples.mdn.mozilla.net/pages/js/array-push.html" width="900" height="520"></iframe>');
    });
    await new Promise<void>((resolve) => host.listen(FIXTURE_PORT + 5, resolve));
    try {
      await open(`http://localhost:${FIXTURE_PORT + 5}/`);
      await until(async () => await snapshot(), /Run/);
      const snap = await snapshot();
      const editor = refOf(snap, 'const animals', 'textbox');
      const run = refOf(snap, 'Run', 'button');
      expect(editor).toMatch(/^f\d+e\d+$/); // inside the cross-origin frame
      expect(run).toMatch(/^f\d+e\d+$/);

      await call('browser_type', { ref: editor, text: 'const word = "helmsman"; console.log(word.toUpperCase());' });
      const clicked = await call('browser_click', { ref: run });
      expect(clicked.isError, clicked.text).toBeFalsy();
      await until(() => text(), /HELMSMAN/);
    } finally {
      host.close();
    }
  });

  test('MDN playground: runner iframe on another origin renders the code and answers clicks', async () => {
    await open('https://developer.mozilla.org/en-US/play');
    await until(async () => await snapshot(), /textbox/);
    let snap = await snapshot();
    const [html, , js] = [...snap.matchAll(/textbox \[ref=(e\d+)\]/g)].map((m) => m[1]);
    expect(html && js, snap.slice(0, 1500)).toBeTruthy();
    await call('browser_type', { ref: html, text: '<button id="b">Press me</button><p id="o">idle</p>' });
    await call('browser_type', { ref: js, text: 'document.getElementById("b").onclick = () => { document.getElementById("o").textContent = "pressed " + location.hostname.split(".").slice(-2).join("."); };' });
    // The toolbar buttons are icon-only in the tree; find locates "Run" by its visible label.
    const run = /ref=(e\d+)/.exec((await call('browser_find', { text: 'Run', maxResults: 5 })).text)?.[1];
    expect(run).toBeTruthy();
    await call('browser_click', { ref: run! });
    await until(async () => await snapshot(), /Press me/);
    snap = await snapshot();
    await call('browser_click', { ref: refOf(snap, 'Press me', 'button') });
    await until(() => text(), /pressed mdnplay\.dev/);
  });

  test('shoelace web components: click buttons, checkbox and details inside shadow roots', async () => {
    await open('https://shoelace.style/components/dialog');
    await until(async () => (await call('browser_find', { text: 'Open Dialog', maxResults: 1 })).text, /sl-button "Open Dialog"/);
    // The docs may greet first-time visitors with a migration banner dialog; dismiss it if it is up.
    const thanks = await call('browser_find', { text: 'No, thanks', maxResults: 1 });
    const thanksRef = /ref=(e\d+)/.exec(thanks.text)?.[1];
    if (thanksRef) await call('browser_click', { ref: thanksRef }).catch(() => {});

    const opener = /ref=(e\d+)/.exec((await call('browser_find', { text: 'Open Dialog', maxResults: 1 })).text)?.[1];
    expect(opener).toBeTruthy();
    const opened = await call('browser_click', { ref: opener! });
    expect(opened.isError, opened.text).toBeFalsy();
    // The dialog host is display:contents (no box), so read its state; its Close button lives in the shadow root.
    const dialogOpen = () => evalJson('document.querySelector(".dialog-overview").open');
    await expect.poll(dialogOpen, { timeout: 10_000 }).toBe(true);
    const close = (await call('browser_find', { text: 'Close', maxResults: 10 })).text.split('\n').find((l) => /sl-button "Close"/.test(l));
    expect(close, 'Close button inside the open dialog').toBeTruthy();
    await call('browser_click', { ref: /ref=(e\d+)/.exec(close!)![1] });
    await expect.poll(dialogOpen, { timeout: 10_000 }).toBe(false);

    await open('https://shoelace.style/components/checkbox');
    await until(async () => (await call('browser_find', { text: 'Checked', maxResults: 10 })).text, /sl-checkbox "Checked"/);
    const isChecked = () => evalJson('[...document.querySelectorAll("sl-checkbox")].find((c) => c.textContent.trim() === "Checked").checked');
    expect(await isChecked()).toBe(true);
    const box = (await call('browser_find', { text: 'Checked', maxResults: 10 })).text.split('\n').find((l) => /sl-checkbox "Checked"/.test(l));
    expect(box).toBeTruthy();
    await call('browser_click', { ref: /ref=(e\d+)/.exec(box!)![1] });
    expect(await isChecked()).toBe(false);
  });

  test('react.dev: open the search dialog, type, navigate results with the keyboard', async () => {
    await open('https://react.dev/learn');
    const snap = await snapshot({ interactiveOnly: true });
    await call('browser_click', { ref: refOf(snap, 'Search', 'button') });
    const dialog = await call('browser_wait_for', { selector: 'input[type=search]', timeout: 10 });
    expect(dialog.isError, dialog.text).toBeFalsy();
    // No ref: typing goes to the focused search box of the dialog.
    const typed = await call('browser_type', { text: 'useState' });
    expect(typed.text).toMatch(/link "useState" \[ref=e\d+\] -> \/reference\/react\/useState/);
    await call('browser_press_key', { key: 'ArrowDown' });
    await call('browser_press_key', { key: 'Enter' });
    await until(pageUrl, /react\.dev\/reference\/react\/useState/);
    expect(await snapshot({ interactiveOnly: true, maxChars: 3000 })).toContain('useState');
    // Escape closes the dialog again on another page.
    const again = await call('browser_press_key', { key: 'Control+k' });
    expect(again.isError, again.text).toBeFalsy();
    await call('browser_press_key', { key: 'Escape' });
  });

  test('Google Sheets (public, view only): canvas grid, screenshot, mouse_xy selects cells, formula bar reads the value', async () => {
    await open('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit');
    await until(async () => await snapshot({ interactiveOnly: false, maxChars: 1500 }), /canvas \[ref=e\d+\] size=\d+x\d+/, 40_000);
    await call('browser_wait_for', { time: 2 });
    const shot = await call('browser_screenshot');
    expect(shot.content.some((c) => c.type === 'image' && (c.data?.length ?? 0) > 5000)).toBe(true);
    expect(shot.text).toMatch(/Viewport \d+x\d+ px/);

    // Cell C3 ("1. Freshman") and A2 ("Alexandra"), found by reading pixels off the screenshot grid.
    let r = await call('browser_mouse_xy', { x: 348, y: 238 });
    expect(r.isError, r.text).toBeFalsy();
    await until(async () => (await call('browser_find', { text: 'Freshman' })).text, /textbox "1\. Freshman"/);
    r = await call('browser_mouse_xy', { x: 100, y: 217 });
    expect(r.isError, r.text).toBeFalsy();
    await until(async () => (await call('browser_find', { text: 'Alexandra' })).text, /textbox "Alexandra"/);
  });

  test('Excalidraw (canvas drawing app): shortcut keys, drag shapes with mouse_xy, screenshot', async () => {
    await open('https://excalidraw.com/');
    await until(async () => await snapshot({ interactiveOnly: false, maxChars: 3000 }), /button "Rectangle"/, 40_000);
    await call('browser_wait_for', { time: 2 });
    const draw = async (key: string, x: number, y: number, toX: number, toY: number) => {
      expect((await call('browser_press_key', { key })).isError).toBeFalsy();
      const r = await call('browser_mouse_xy', { action: 'drag', x, y, toX, toY });
      expect(r.isError, r.text).toBeFalsy();
    };
    await draw('r', 420, 300, 620, 420);
    await draw('o', 700, 300, 900, 420);
    // Excalidraw autosaves to localStorage a moment after each change.
    await expect.poll(async () => await evalJson('JSON.parse(localStorage.getItem("excalidraw") || "[]").map((e) => e.type)'), { timeout: 15_000 }).toEqual(['rectangle', 'ellipse']);
    const shot = await call('browser_screenshot');
    expect(shot.content.some((c) => c.type === 'image' && (c.data?.length ?? 0) > 5000)).toBe(true);
  });

  test('the-internet: select option, checkbox toggle', async () => {
    await open('https://the-internet.herokuapp.com/dropdown');
    let snap = await snapshot();
    const pick = await call('browser_select_option', { ref: refOf(snap, 'Please select an option'), values: ['Option 2'] });
    expect(pick.isError, pick.text).toBeFalsy();
    expect(await snapshot()).toMatch(/Option 2/);
    expect(await evalJson('document.querySelector("#dropdown").value')).toBe('2');

    await open('https://the-internet.herokuapp.com/checkboxes');
    snap = await snapshot();
    const first = refOf(snap, '', 'checkbox');
    await call('browser_click', { ref: first });
    expect(await evalJson('[...document.querySelectorAll("input[type=checkbox]")].map(c => c.checked)')).toEqual([true, true]);
  });

  test('the-internet: file upload and download', async () => {
    await open('https://the-internet.herokuapp.com/upload');
    const snap = await snapshot();
    const up = await call('browser_file_upload', {
      ref: refOf(snap, '"file"', 'button'),
      files: [{ name: 'helmsman-real-site.txt', mimeType: 'text/plain', base64: Buffer.from('xin chào từ Helmsman').toString('base64') }],
    });
    expect(up.isError, up.text).toBeFalsy();
    await call('browser_click', { ref: refOf(snap, 'Upload', 'button') });
    await until(() => text(), /File Uploaded!/);
    expect(await text()).toContain('helmsman-real-site.txt');

    await open('https://the-internet.herokuapp.com/download');
    const links = await call('browser_extract', { what: ['links'], maxItems: 200 });
    const href = /"href":\s*"([^"]*\/download\/[^"]+\.txt)"/.exec(links.text)?.[1];
    expect(href, links.text.slice(0, 800)).toBeTruthy();
    const dl = await call('browser_download', { url: href!, filename: 'helmsman-real-site-download.txt' });
    expect(dl.isError, dl.text).toBeFalsy();
    // The tool waits for completion and reports the saved path.
    const file = /Downloaded to (.+)\.\s/.exec(`${dl.text} `)?.[1];
    expect(file, dl.text).toBeTruthy();
    // Playwright redirects downloads into its own artifacts folder (GUID file names), so nothing lands in the real Downloads.
    expect(fs.statSync(file!).size).toBeGreaterThan(0);
    expect(fs.readFileSync(file!, 'utf8').length).toBeGreaterThan(0);
  });

  test('the-internet: JS alert, confirm and prompt dialogs', async () => {
    await open('https://the-internet.herokuapp.com/javascript_alerts');
    const snap = await snapshot();
    let r = await call('browser_click', { ref: refOf(snap, 'Click for JS Alert', 'button') });
    expect(r.text).toContain('alert dialog is open');
    r = await call('browser_handle_dialog', { accept: true });
    expect(r.isError, r.text).toBeFalsy();
    expect(await text()).toContain('You successfully clicked an alert');

    r = await call('browser_click', { ref: refOf(snap, 'Click for JS Confirm', 'button') });
    expect(r.text).toContain('confirm dialog is open');
    await call('browser_handle_dialog', { accept: false });
    expect(await text()).toContain('You clicked: Cancel');

    r = await call('browser_click', { ref: refOf(snap, 'Click for JS Prompt', 'button') });
    expect(r.text).toContain('prompt dialog is open');
    await call('browser_handle_dialog', { accept: true, promptText: 'Xin chào' });
    expect(await text()).toContain('You entered: Xin chào');
  });

  test('the-internet: nested frames (frameset inside frameset)', async () => {
    await open('https://the-internet.herokuapp.com/nested_frames');
    await until(async () => await snapshot(), /BOTTOM/);
    const snap = await snapshot();
    for (const label of ['LEFT', 'MIDDLE', 'RIGHT', 'BOTTOM']) expect(snap, `snapshot lacks ${label}`).toContain(label);
    const found = await call('browser_find', { text: 'MIDDLE' });
    expect(found.text).toMatch(/ref=f\d+e\d+/);
    expect(await text()).toContain('MIDDLE');
  });

  test('the-internet: HTML5 drag and drop swaps the columns', async () => {
    await open('https://the-internet.herokuapp.com/drag_and_drop');
    const snap = await snapshot();
    const r = await call('browser_drag', { startRef: refOf(snap, '"A"'), endRef: refOf(snap, '"B"') });
    expect(r.isError, r.text).toBeFalsy();
    expect(await evalJson('[...document.querySelectorAll("#columns header")].map(h => h.textContent.trim())')).toEqual(['B', 'A']);
  });

  test('the-internet: infinite scroll and dynamic loading (wait_for selector)', async () => {
    await open('https://the-internet.herokuapp.com/infinite_scroll');
    const count = async () => Number(await evalJson('document.querySelectorAll(".jscroll-added").length'));
    const before = await count();
    for (let i = 0; i < 4 && (await count()) <= before; i++) {
      await call('browser_scroll', { direction: 'down', amount: 3000 });
      await call('browser_wait_for', { time: 1 });
    }
    expect(await count()).toBeGreaterThan(before);

    await open('https://the-internet.herokuapp.com/dynamic_loading/2');
    const snap = await snapshot();
    await call('browser_click', { ref: refOf(snap, 'Start', 'button') });
    const waited = await call('browser_wait_for', { selector: '#finish', timeout: 20 });
    expect(waited.isError, waited.text).toBeFalsy();
    expect(await text()).toContain('Hello World!');
    // Regression: selectorGone used to count display:none elements as still present, so it timed out here
    // although #loading is hidden after the load; it now means "no visible match", as the tool description says.
    const gone = await call('browser_wait_for', { selectorGone: '#loading', timeout: 5 });
    expect(gone.isError, gone.text).toBeFalsy();
  });
});
