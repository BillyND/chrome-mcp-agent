// Unit tests for snapshot diffing, the output budget, profiles, secrets, locators and workflow arguments.

import { describe, expect, it } from 'vitest';
import { HandleStore } from '../extension/src/background/output/handles';
import { cutPoint, limitFor, NOTE_RESERVE, readChunk, truncateWithHandle } from '../extension/src/background/output/limit';
import { Baselines } from '../extension/src/background/snapshot/baselines';
import { diffSnapshots, formatDiff } from '../extension/src/background/snapshot/diff';
import { linesWithin, planSnapshot } from '../extension/src/background/snapshot/render';
import { hasPlaceholder, isValidSecret, normalizeSecretName, redactDeep, redactSecrets, substituteSecrets } from '../extension/src/background/secrets/redact';
import { applyParams, hasLocator, LOCATOR_KEY, mapRefs, parametrize, resolveLocators, stepLabel } from '../extension/src/background/workflows/args';
import { type Candidate, framePathOf, type Locator, MATCH_THRESHOLD, pickBest, scoreMatch, similarity, urlPath } from '../extension/src/locator';
import { CORE_TOOL_NAMES, MAX_OUTPUT_CHARS, parseProfile, TOOLS, toolsForProfile } from '../shared/tools';
import { parseWorkflowDetail, parseWorkflowList, promptArguments, workflowInstruction } from '../shared/workflow-prompt';

const lines = (n: number, make = (i: number) => `  - text: line ${i}`) => Array.from({ length: n }, (_, i) => make(i));

describe('snapshot diff', () => {
  const base = ['- heading "Inbox" [level=1]', '- button "Send" [ref=e1]', '- textbox "To" [ref=e2] value="a"', '- text: Hello', '- link "Help" [ref=e3] -> /help'];

  it('reports nothing for identical snapshots', () => {
    const d = diffSnapshots(base, base)!;
    expect(d.entries).toEqual([]);
    expect(d.unchanged).toBe(5);
    expect(formatDiff(d)).toContain('no changes');
  });

  it('pairs a line that kept its ref as changed, not removed plus added', () => {
    const next = [...base];
    next[2] = '- textbox "To" [ref=e2] value="ab"';
    const d = diffSnapshots(base, next)!;
    expect(d.changed).toEqual(['- textbox "To" [ref=e2] value="ab"']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(4);
  });

  it('pairs ref-less lines of the same kind and indent (a counter text)', () => {
    const d = diffSnapshots(['- text: Đếm: 0', '- button "Tăng" [ref=e1]'], ['- text: Đếm: 1', '- button "Tăng" [ref=e1]'])!;
    expect(d.changed).toEqual(['- text: Đếm: 1']);
    expect(d.unchanged).toBe(1);
  });

  it('finds added and removed lines in page order', () => {
    const next = ['- heading "Inbox" [level=1]', '- button "Send" [ref=e1]', '  - alert: Sent!', '- text: Hello', '- link "Help" [ref=e3] -> /help', '- button "New" [ref=e9]'];
    const d = diffSnapshots(base, next)!;
    expect(d.added).toEqual(['  - alert: Sent!', '- button "New" [ref=e9]']);
    expect(d.removed).toEqual(['- textbox "To" [ref=e2] value="a"']);
    expect(d.entries.map((e) => e.mark)).toEqual(['-', '+', '+']);
    const text = formatDiff(d);
    expect(text).toContain('+2 −1 ~0 lines; unchanged: 4');
    expect(text).toContain('+   - alert: Sent!');
  });

  it('handles a big page with a tiny change quickly and exactly', () => {
    const page = lines(3000, (i) => `- button "Item ${i}" [ref=e${i}]`);
    const next = [...page];
    next[1500] = '- button "Item 1500 (done)" [ref=e1500]';
    next.splice(2000, 0, '- text: inserted');
    const d = diffSnapshots(page, next)!;
    expect(d.changed).toHaveLength(1);
    expect(d.added).toEqual(['- text: inserted']);
    expect(d.unchanged).toBe(2999);
  });

  it('gives up when the pages are completely different', () => {
    expect(diffSnapshots(lines(1500, (i) => `- a ${i}`), lines(1500, (i) => `- b ${i}`))).toBeNull();
  });

  it('plans: full when asked, diff only when clearly smaller, full on another page', () => {
    const prev = { url: 'https://x/a', lines: base };
    const next = [...base];
    next[3] = '- text: Bye';
    const big = lines(200, (i) => `- button "Item ${i}" [ref=e${i}]`);
    const bigNext = [...big];
    bigNext[5] = '- button "Item 5!" [ref=e5]';

    expect(planSnapshot(prev, 'https://x/a', next, 'full', 9999).kind).toBe('full');
    expect(planSnapshot(undefined, 'https://x/a', next, 'auto', 9999)).toMatchObject({ kind: 'full', note: undefined });
    expect(planSnapshot(undefined, 'https://x/a', next, 'diff', 9999).note).toMatch(/no earlier snapshot/);
    expect(planSnapshot(prev, 'https://x/other', next, 'auto', 9999).kind).toBe('full');
    // Tiny page: the diff header costs more than the page itself.
    expect(planSnapshot(prev, 'https://x/a', next, 'diff', 9999)).toMatchObject({ kind: 'full', note: expect.stringMatching(/not be smaller/) });
    const plan = planSnapshot({ url: 'u', lines: big }, 'u', bigNext, 'auto', 99999);
    expect(plan.kind).toBe('diff');
    expect(plan.body.length).toBeLessThan(bigNext.join('\n').length / 10);
  });

  it('linesWithin keeps whole lines that fit', () => {
    expect(linesWithin(['aaaa', 'bbbb', 'cccc'], 9)).toEqual(['aaaa', 'bbbb']);
    expect(linesWithin(['aaaa', 'bbbb', 'cccc'], 3)).toEqual([]);
    expect(linesWithin(['aaaa', 'bbbb'], 99)).toEqual(['aaaa', 'bbbb']);
  });

  it('baselines are per tab, agent and view, bounded, and cleared per tab', () => {
    const b = new Baselines();
    b.set(1, 'a', '', { url: 'u', lines: ['x'] });
    b.set(1, 'b', '', { url: 'u', lines: ['y'] });
    b.set(2, 'a', '', { url: 'u', lines: ['z'] });
    expect(b.get(1, 'a', '')?.lines).toEqual(['x']);
    expect(b.get(1, 'b', '')?.lines).toEqual(['y']);
    expect(b.get(1, 'a', 'other')).toBeUndefined();
    b.clearTab(1);
    expect(b.get(1, 'a', '')).toBeUndefined();
    expect(b.get(2, 'a', '')?.lines).toEqual(['z']);
    for (let i = 0; i < 100; i++) b.set(100 + i, 'a', '', { url: 'u', lines: [] });
    expect(b.get(2, 'a', '')).toBeUndefined(); // oldest evicted
    expect(b.get(199, 'a', '')).toBeDefined();
  });
});

describe('output budget', () => {
  it('limitFor clamps to the global maximum and a sane minimum', () => {
    expect(limitFor({})).toBe(MAX_OUTPUT_CHARS);
    expect(limitFor({ maxChars: 5_000_000 })).toBe(MAX_OUTPUT_CHARS);
    expect(limitFor({ maxChars: 10 })).toBe(1000);
    expect(limitFor({ maxChars: 12_000 })).toBe(12_000);
    expect(limitFor({ maxChars: 'abc' })).toBe(MAX_OUTPUT_CHARS);
  });

  it('leaves short text alone', () => {
    const store = new HandleStore();
    expect(truncateWithHandle('a', 'short', 100, store)).toEqual({ text: 'short', truncated: false, shown: 5 });
  });

  it('cuts long text within the limit, with a note, and pages the rest back exactly', () => {
    const store = new HandleStore();
    const full = Array.from({ length: 4000 }, (_, i) => `line number ${i} with some padding text`).join('\n');
    const first = truncateWithHandle('agent', full, 5000, store);
    expect(first.truncated).toBe(true);
    expect(first.text.length).toBeLessThanOrEqual(5000);
    expect(first.text).toMatch(/browser_read_more \{"handle":"h\d+","offset":\d+\}/);
    const handle = /"handle":"(h\d+)"/.exec(first.text)![1];
    let rebuilt = first.text.slice(0, first.shown);
    expect(full.startsWith(rebuilt)).toBe(true);
    let offset = first.shown;
    let guard = 0;
    while (offset < full.length && guard++ < 200) {
      const chunk = readChunk('agent', handle, offset, 5000, store)!;
      expect(chunk.length).toBeLessThanOrEqual(5000);
      const [, from, end] = /^Characters (\d+)-(\d+) of/.exec(chunk)!.map(Number);
      expect(from).toBe(offset);
      rebuilt += full.slice(offset, end);
      offset = end;
    }
    expect(rebuilt).toBe(full);
    expect(readChunk('agent', handle, offset - 1, 5000, store)).toContain('[end of text]');
  });

  it('cuts at a line break when there is one near the end', () => {
    const text = `${'a'.repeat(90)}\n${'b'.repeat(90)}`;
    expect(cutPoint(text, 0, 100)).toBe(90);
    expect(cutPoint('x'.repeat(300), 0, 100)).toBe(100);
    expect(cutPoint('short', 0, 100)).toBe(5);
  });

  it('keeps handles private to their agent, expires old ones, and reports past-the-end offsets', () => {
    const store = new HandleStore();
    const big = 'x'.repeat(2000);
    const own = truncateWithHandle('a', big, 1000, store);
    const handle = /"handle":"(h\d+)"/.exec(own.text)![1];
    expect(readChunk('b', handle, 0, 1000, store)).toBeUndefined();
    expect(readChunk('a', 'h999', 0, 1000, store)).toBeUndefined();
    expect(readChunk('a', handle, 5000, 1000, store)).toMatch(/past the end/);
    for (let i = 0; i < 20; i++) truncateWithHandle('a', big, 1000, store);
    expect(readChunk('a', handle, 0, 1000, store)).toBeUndefined();
  });

  it('reserves room for its notes', () => {
    expect(NOTE_RESERVE).toBeGreaterThan(200);
  });
});

describe('tool profiles', () => {
  it('core is a short subset that still can read, act and page', () => {
    const core = toolsForProfile('core');
    expect(core.length).toBe(CORE_TOOL_NAMES.length);
    expect(core.length).toBeLessThanOrEqual(14);
    expect(core.length).toBeLessThan(TOOLS.length / 2);
    for (const name of ['browser_snapshot', 'browser_click', 'browser_type', 'browser_read_more', 'browser_navigate']) {
      expect(core.map((t) => t.name)).toContain(name);
    }
    for (const name of CORE_TOOL_NAMES) expect(TOOLS.map((t) => t.name)).toContain(name);
  });

  it('full is everything, and unknown values mean full', () => {
    expect(toolsForProfile('full')).toBe(TOOLS);
    expect(parseProfile('core')).toBe('core');
    expect(parseProfile(' CORE ')).toBe('core');
    expect(parseProfile('full')).toBe('full');
    expect(parseProfile('whatever')).toBe('full');
    expect(parseProfile(undefined)).toBe('full');
    expect(parseProfile(null)).toBe('full');
  });

  it('the new tools exist with valid schemas', () => {
    for (const name of ['browser_read_more', 'browser_secrets_list', 'browser_workflow']) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.type).toBe('object');
    }
    const snapshot = TOOLS.find((t) => t.name === 'browser_snapshot')!.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(snapshot)).toEqual(expect.arrayContaining(['mode', 'ref', 'depth', 'interactiveOnly', 'maxChars']));
  });
});

describe('secrets', () => {
  const secrets = { PW: 'hunter2!', TOKEN: 'abc"def\\ghi', URLY: 'a b&c=d', SHORT: 'ab' };

  it('substitutes placeholders and rejects unknown names with the saved ones listed', () => {
    expect(substituteSecrets('user:{{secret:PW}}', secrets)).toBe('user:hunter2!');
    expect(substituteSecrets('no placeholders', secrets)).toBe('no placeholders');
    expect(() => substituteSecrets('{{secret:NOPE}}', secrets)).toThrow(/Unknown secret "NOPE".*PW/);
    expect(() => substituteSecrets('{{secret:NOPE}}', {})).toThrow(/not saved any secrets/);
  });

  it('redacts raw, JSON-escaped, URL-encoded and HTML-escaped values', () => {
    expect(redactSecrets('value="hunter2!" ok', secrets)).toBe('value="{{secret:PW}}" ok');
    expect(redactSecrets(JSON.stringify({ v: secrets.TOKEN }), secrets)).toBe('{"v":"{{secret:TOKEN}}"}');
    expect(redactSecrets('https://x/?q=a%20b%26c%3Dd', secrets)).toBe('https://x/?q={{secret:URLY}}');
    // A script that returns JSON.stringify(value) comes back JSON-encoded a second time.
    const inner = JSON.stringify(secrets.TOKEN).slice(1, -1);
    const twice = JSON.stringify(inner).slice(1, -1);
    expect(twice).not.toBe(inner);
    expect(redactSecrets(`"x ${twice} y"`, secrets)).toBe('"x {{secret:TOKEN}} y"');
    expect(redactSecrets(encodeURIComponent(encodeURIComponent(secrets.URLY)), secrets)).toBe('{{secret:URLY}}');
    expect(redactSecrets('hunter2! and hunter2!', secrets)).toBe('{{secret:PW}} and {{secret:PW}}');
  });

  it('does not redact values too short to be safe, nor touch clean text', () => {
    expect(redactSecrets('ab cab', secrets)).toBe('ab cab');
    expect(redactSecrets('nothing here', {})).toBe('nothing here');
  });

  it('is a single pass: a secret that looks like part of a placeholder does not corrupt it', () => {
    const tricky = { A: 'secret', B: 'xyz789' };
    expect(redactSecrets('secret and xyz789', tricky)).toBe('{{secret:A}} and {{secret:B}}');
  });

  it('prefers the longest match when secrets overlap', () => {
    expect(redactSecrets('password123', { SHORTER: 'password', LONGER: 'password123' })).toBe('{{secret:LONGER}}');
  });

  it('redacts inside nested data and detects placeholders', () => {
    expect(redactDeep({ a: ['x hunter2!'], b: { c: 'hunter2!' }, n: 3 }, secrets)).toEqual({ a: ['x {{secret:PW}}'], b: { c: '{{secret:PW}}' }, n: 3 });
    expect(hasPlaceholder('go {{secret:PW}}')).toBe(true);
    expect(hasPlaceholder('go')).toBe(false);
  });

  it('validates names and values', () => {
    expect(isValidSecret('GITHUB_PW', 'abcd')).toBe(true);
    expect(isValidSecret('bad name', 'abcd')).toBe(false);
    expect(isValidSecret('', 'abcd')).toBe(false);
    expect(isValidSecret('OK', 'ab')).toBe(true); // short values are allowed (typed, not text-redacted)
    expect(isValidSecret('OK', '')).toBe(false);
    expect(normalizeSecretName('mật khẩu Gmail đỏ')).toBe('mat_khau_Gmail_do');
  });
});

describe('locators', () => {
  const button = { role: 'button', name: 'Tăng', tag: 'button' };

  it('compares names loosely but not blindly', () => {
    expect(similarity('Sign in', ' sign   IN ')).toBe(1);
    expect(similarity('Add to cart', 'Add to cart (2)')).toBeGreaterThan(0.8);
    expect(similarity('Delete', 'Save')).toBe(0);
    expect(similarity('', 'x')).toBe(0);
  });

  it('scores role and name together', () => {
    expect(scoreMatch(button, { ...button })).toBeGreaterThanOrEqual(80);
    expect(scoreMatch(button, { ...button, role: 'link' })).toBe(0);
    expect(scoreMatch(button, { ...button, name: 'Giảm' })).toBeLessThan(MATCH_THRESHOLD);
    expect(scoreMatch(button, { ...button, name: 'Tăng (3)' })).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    // Stable attributes lift a renamed control over the threshold.
    expect(scoreMatch({ ...button, testId: 'inc' }, { ...button, name: 'Increase', testId: 'inc' })).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  const loc = (over: Partial<Locator> = {}): Locator => ({ ...button, nth: 0, frame: [], ...over });
  const cand = (ref: string, score: number, over: Partial<Candidate> = {}): Candidate => ({ ref, score, nth: 0, frame: [], ...over });

  it('picks the best candidate and nothing when none is convincing', () => {
    expect(pickBest(loc(), [cand('e1', 60), cand('e2', 90)])?.ref).toBe('e2');
    expect(pickBest(loc(), [cand('e1', 40), cand('e2', MATCH_THRESHOLD - 1)])).toBeUndefined();
    expect(pickBest(loc(), [])).toBeUndefined();
  });

  it('breaks ties by position among same-named elements', () => {
    expect(pickBest(loc({ nth: 1 }), [cand('e1', 85, { nth: 0 }), cand('e2', 85, { nth: 1 }), cand('e3', 85, { nth: 2 })])?.ref).toBe('e2');
  });

  it('prefers the element in the recorded frame', () => {
    const want = loc({ frame: ['http://b/cross.html'] });
    expect(pickBest(want, [cand('e1', 85), cand('f2e1', 85, { frame: ['http://b/cross.html'] })])?.ref).toBe('f2e1');
    // ...but a lone match in another frame still beats giving up.
    expect(pickBest(want, [cand('e1', 85)])?.ref).toBe('e1');
  });

  it('describes frames by URL path and walks up to the top page', () => {
    expect(urlPath('http://localhost:4100/a/b.html?x=1#h')).toBe('http://localhost:4100/a/b.html');
    expect(urlPath('about:blank')).toBe('about:blank');
    const frames = [
      { frameId: 0, parentFrameId: -1, url: 'http://a/' },
      { frameId: 5, parentFrameId: 0, url: 'http://b/cross.html?q' },
      { frameId: 9, parentFrameId: 5, url: 'http://a/nested.html' },
    ];
    expect(framePathOf(frames, 0)).toEqual([]);
    expect(framePathOf(frames, 5)).toEqual(['http://b/cross.html']);
    expect(framePathOf(frames, 9)).toEqual(['http://b/cross.html', 'http://a/nested.html']);
  });
});

describe('workflow arguments', () => {
  const locator: Locator = { role: 'textbox', name: 'Họ tên', tag: 'input', nth: 0, frame: [] };

  it('replaces refs with locators and back, including nested field lists', async () => {
    const args = { ref: 'e5', text: 'x', fields: [{ ref: 'f3e1', value: 'v' }], tabId: 1 };
    const recorded = (await mapRefs(args, async (ref) => ({ [LOCATOR_KEY]: { ...locator, name: ref } }))) as typeof args;
    expect(hasLocator(recorded)).toBe(true);
    expect(typeof (recorded as { ref: unknown }).ref).toBe('object');
    expect(typeof (recorded as { fields: Array<{ ref: unknown }> }).fields[0].ref).toBe('object');
    expect(recorded.tabId).toBe(1);
    const replayed = (await resolveLocators(recorded, async (l) => `ref-of-${l.name}`)) as { ref: string; fields: Array<{ ref: string }> };
    expect(replayed.ref).toBe('ref-of-e5');
    expect(replayed.fields[0].ref).toBe('ref-of-f3e1');
    expect(hasLocator(replayed)).toBe(false);
  });

  it('fills parameters and says which one is missing', () => {
    expect(applyParams({ text: 'Xin chào {{param:name}}', n: [1, '{{param:city}}'] }, { name: 'An', city: 'Huế' })).toEqual({ text: 'Xin chào An', n: [1, 'Huế'] });
    expect(() => applyParams({ text: '{{param:nope}}' }, {})).toThrow(/"nope"/);
    expect(applyParams({ text: '{{secret:PW}}' }, {})).toEqual({ text: '{{secret:PW}}' });
  });

  it('turns recorded literals into parameters without touching locators', () => {
    const step = { text: 'Hà Nội', ref: { [LOCATOR_KEY]: { ...locator, name: 'Hà Nội' } } };
    const { value, used } = parametrize(step, { city: 'Hà Nội' });
    expect(used).toEqual(['city']);
    expect((value as typeof step).text).toBe('{{param:city}}');
    expect((value as typeof step).ref[LOCATOR_KEY].name).toBe('Hà Nội');
    expect(parametrize({ text: 'abc' }, { x: 'zzz' }).used).toEqual([]);
  });

  it('labels steps for people', () => {
    expect(stepLabel('browser_click', { ref: { [LOCATOR_KEY]: { role: 'button', name: 'Tăng', tag: 'button' } } })).toBe('browser_click button "Tăng"');
    expect(stepLabel('browser_navigate', { url: 'http://x/' })).toBe('browser_navigate http://x/');
    expect(stepLabel('browser_type', { text: 'hello', ref: { [LOCATOR_KEY]: locator } })).toBe('browser_type textbox "Họ tên" "hello"');
  });
});

describe('workflow prompts', () => {
  it('parses what the extension lists and ignores junk', () => {
    expect(parseWorkflowList('{"workflows":[{"name":"a","steps":2,"params":{"city":"Hà Nội"}},{"nope":1}]}')).toHaveLength(1);
    expect(parseWorkflowList('not json')).toEqual([]);
    expect(parseWorkflowList(undefined)).toEqual([]);
    expect(parseWorkflowDetail('{"name":"a","steps":["x"]}')?.name).toBe('a');
    expect(parseWorkflowDetail('{}')).toBeUndefined();
  });

  it('builds a ready-to-follow instruction', () => {
    const w = { name: 'Đặt hàng', description: 'Order a thing', params: { city: 'Hà Nội' }, steps: ['browser_click button "Mua"', 'browser_type textbox "Thành phố" "{{param:city}}"'] };
    const text = workflowInstruction(w, { city: 'Huế' });
    expect(text).toContain('"Đặt hàng"');
    expect(text).toContain(JSON.stringify({ action: 'run', name: 'Đặt hàng', params: { city: 'Huế' } }));
    expect(text).toContain('1. browser_click button "Mua"');
    expect(workflowInstruction({ name: 'x' })).toContain('{"action":"run","name":"x"}');
    expect(promptArguments(w)).toEqual([expect.objectContaining({ name: 'city', required: false })]);
  });
});
