// The safety layer's entry points, enforced in the extension so it holds for every MCP client:
// - siteGate: per-site allow / ask / block, before anything touches a tab;
// - guardClick / guardTyping / guardKey / guardDownload / guardUpload: hard refusals and
//   "ask the user first" for sensitive actions;
// - finish: the untrusted envelope around page content, plus the login / CAPTCHA hand-back hint.

import type { ToolContent } from '../../../../shared/protocol';
import type { Choice, ElementFacts, PageGates } from '../../messages';
import { sessionOf } from '../cdp';
import { callAllFrames, frameCall, parseRef } from '../frames';
import { STOPPED, ToolError, TrustedError, type ToolCtx } from '../tools/types';
import { ask } from './approvals';
import { checkAccountCreation, checkTyping, checkUpload } from './hard-blocks';
import { factsAtPoint } from './point-facts';
import { classifyClick, classifyDrop, classifySubmit, classifyTyping, type Verdict } from './sensitive';
import { decideSite, hostOf, scriptRule } from './site-rules';
import { getGrant, getRules, getSettings, setGrant, setRule, setScriptsEverywhere } from './store';
import { HANDBACK_HINT, wrapUntrusted } from './untrusted';

function REFUSED(ctx: ToolCtx, message: string): never {
  ctx.audit.outcome = 'blocked';
  throw new TrustedError(message);
}

/** Where to draw a question: the tab the call works on, else the tab in front. */
async function questionTab(ctx: ToolCtx): Promise<number> {
  if (ctx.tabId >= 0) return ctx.tabId;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active?.id ?? -1;
}

function declined(ctx: ToolCtx, choice: Choice | 'timeout', what: string, timeoutMs: number): never {
  ctx.audit.outcome = 'declined';
  ctx.audit.approval = choice === 'timeout' ? 'timeout' : 'declined';
  throw new TrustedError(
    choice === 'timeout'
      ? `The user did not answer within ${Math.round(timeoutMs / 1000)}s, so ${what} was declined. Do not retry it; ask the user in chat how to proceed.`
      : `The user declined ${what}. Do not retry it or find another way; tell the user what you wanted to do and ask how to proceed.`,
  );
}

// ---- sites -------------------------------------------------------------------------------

const asking = new Map<string, Promise<void>>();

/**
 * Asks "allow this agent ...?" once per grant. `rule` is the key the answer is stored under (a host, or "script:host"):
 * Once is a timed grant, Always becomes an allow rule, All (scripts only) turns on "scripts on every site", Decline is remembered briefly so the agent cannot nag.
 */
async function grantGate(ctx: ToolCtx, kind: 'site' | 'script', host: string, rule: string, what: string): Promise<void> {
  const grant = await getGrant(ctx.agent, rule);
  if (grant === true) return;
  if (grant === false) declined(ctx, 'decline', what, 0);

  const key = `${ctx.agent}|${rule}`;
  const inFlight = asking.get(key);
  if (inFlight) {
    await inFlight.catch(() => {});
    return grantGate(ctx, kind, host, rule, what); // the answer is now a grant
  }
  const settings = await getSettings();
  const question = (async () => {
    const choice = await ask({ tabId: await questionTab(ctx), kind, agent: ctx.agent, host }, ctx.signal, settings.approvalTimeoutMs);
    if (choice === 'once') await setGrant(ctx.agent, rule, true, settings.grantMs);
    else if (choice === 'always') await setRule(rule, 'allow');
    else if (choice === 'all') await setScriptsEverywhere(true);
    else await setGrant(ctx.agent, rule, false, settings.denyMs);
    return choice;
  })();
  asking.set(key, question.then(() => {}, () => {}));
  try {
    const choice = await question;
    if (choice === 'once' || choice === 'always' || choice === 'all') {
      ctx.audit.approval = 'approved';
      return;
    }
    declined(ctx, choice, what, settings.approvalTimeoutMs);
  } finally {
    asking.delete(key);
  }
}

/** Throws unless the agent may use `url`'s site. Unknown sites are allowed; "ask" sites prompt the user once per grant. */
export async function siteGate(ctx: ToolCtx, url: string): Promise<void> {
  const decision = decideSite(url, await getRules());
  if (!decision.host) return;
  ctx.audit.host = decision.host;
  if (decision.action === 'allow') return;
  if (decision.action === 'block') {
    const why = decision.source === 'default' ? `blocked by default (${decision.category})` : 'blocked by a rule the user set';
    REFUSED(ctx, `${decision.host} is ${why} in Helmsman. Do not reach it another way (another tool or URL); tell the user, who can unblock it in the Helmsman popup under Sites.`);
  }
  await grantGate(ctx, 'site', decision.host, decision.host, `access to ${decision.host}`);
}

/** Before running the agent's own JavaScript in a tab: the user allows it per site (once, or always as the rule "script:<host>"). */
export async function guardScript(ctx: ToolCtx, tabId: number): Promise<void> {
  if ((await getSettings()).scriptsEverywhere) return;
  const host = (await hostOfTab(tabId)) || 'this page';
  const rule = scriptRule(host);
  if ((await getRules())[rule] === 'allow') return;
  await grantGate(ctx, 'script', host, rule, `running scripts on ${host}`);
}

// ---- elements ----------------------------------------------------------------------------

/** Facts about the element behind `ref`, or about whatever has keyboard focus when no ref is given. */
async function factsOf(tabId: number, ref?: string): Promise<ElementFacts | null> {
  if (ref) {
    const { frameId, local } = parseRef(ref);
    return frameCall<ElementFacts>(tabId, frameId, { cmd: 'describe-target', ref: local }).catch(() => null);
  }
  const all = await callAllFrames<ElementFacts>(tabId, () => ({ cmd: 'describe-target' }));
  return all.map((a) => a.value).find((f) => !['body', 'html', 'iframe', 'frame'].includes(f.tag)) ?? null;
}

async function hostOfTab(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return hostOf(tab?.url ?? '');
}

/** Asks the user to approve `verdict` and returns when they did; throws when they declined or did not answer. */
async function confirm(ctx: ToolCtx, tabId: number, verdict: Verdict): Promise<void> {
  if (verdict.level === 'allow') return;
  const settings = await getSettings();
  const host = await hostOfTab(tabId);
  const choice = await ask({ tabId, kind: 'sensitive', agent: ctx.agent, host, label: verdict.label, category: verdict.category }, ctx.signal, settings.approvalTimeoutMs);
  if (choice !== 'approve') declined(ctx, choice, `this action (${verdict.category}: "${verdict.label}")`, settings.approvalTimeoutMs);
  ctx.audit.approval = 'approved';
  ctx.notes.push(`The user approved this action (${verdict.category}: "${verdict.label}").`);
}

/** Refuses account creation and asks about sensitive clicks, for an element already described. */
async function checkClick(ctx: ToolCtx, tabId: number, facts: ElementFacts | null): Promise<void> {
  if (!facts) return;
  const refusal = checkAccountCreation(facts);
  if (refusal) REFUSED(ctx, refusal);
  await confirm(ctx, tabId, classifyClick(facts));
}

/** Before clicking the element behind `ref`. */
export const guardClick = async (ctx: ToolCtx, tabId: number, ref: string): Promise<void> => checkClick(ctx, tabId, await factsOf(tabId, ref));

/** Before clicking at a top-level viewport point: the element under it, in whichever frame it is, is judged like a ref. */
export const guardPoint = async (ctx: ToolCtx, tabId: number, x: number, y: number): Promise<void> => checkClick(ctx, tabId, await factsAtPoint(tabId, x, y));

type Point = { x: number; y: number };

/** Before dragging between two viewport points: the press is judged like a click, the drop like typing or attaching. */
export async function guardDrag(ctx: ToolCtx, tabId: number, from: Point, to: Point): Promise<void> {
  await guardPoint(ctx, tabId, from.x, from.y);
  const dropped = await factsAtPoint(tabId, to.x, to.y);
  if (dropped) await confirm(ctx, tabId, classifyDrop(dropped));
}

/** Before typing `value` into the element behind `ref` (or the focused element), optionally followed by Enter. */
export async function guardTyping(ctx: ToolCtx, tabId: number, ref: string | undefined, value: string, submit = false): Promise<void> {
  const facts = await factsOf(tabId, ref);
  if (!facts) return;
  const refusal = checkTyping(facts, value);
  if (refusal) REFUSED(ctx, refusal);
  await confirm(ctx, tabId, classifyTyping(facts));
  if (submit) await guardEnter(ctx, tabId, facts);
}

async function guardEnter(ctx: ToolCtx, tabId: number, facts: ElementFacts): Promise<void> {
  const refusal = checkAccountCreation({ ...facts, isSubmit: facts.inForm });
  if (refusal) REFUSED(ctx, refusal);
  await confirm(ctx, tabId, facts.isSubmit || facts.role === 'button' ? classifyClick(facts) : classifySubmit(facts));
}

/** Before pressing a key: Enter can submit a form or activate a button. */
export async function guardKey(ctx: ToolCtx, tabId: number, combo: string): Promise<void> {
  if (!/^(enter|return)$/i.test(combo.split('+').pop() ?? '')) return;
  const facts = await factsOf(tabId);
  if (facts) await guardEnter(ctx, tabId, facts);
}

/** Before saving a file from `url` into the user's Downloads. */
export async function guardDownload(ctx: ToolCtx, url: string): Promise<void> {
  const label = url.length > 80 ? `${url.slice(0, 77)}…` : url;
  const settings = await getSettings();
  const tabId = await questionTab(ctx);
  const choice = await ask({ tabId, kind: 'sensitive', agent: ctx.agent, host: hostOf(url), label, category: 'download' }, ctx.signal, settings.approvalTimeoutMs);
  if (choice !== 'approve') declined(ctx, choice, `this download (${label})`, settings.approvalTimeoutMs);
  ctx.audit.approval = 'approved';
  ctx.notes.push(`The user approved this download (${label}).`);
}

/** Refuses credential-looking files and files over 25 MB. `bytes` may be unknown until the file is fetched. */
export function guardUpload(ctx: ToolCtx, name: string, bytes?: number): void {
  const refusal = checkUpload(name, bytes);
  if (refusal) REFUSED(ctx, refusal);
}

// ---- results -----------------------------------------------------------------------------

async function pageGates(tabId: number): Promise<PageGates> {
  const found = await callAllFrames<PageGates>(tabId, () => ({ cmd: 'detect-gates' }), 1500).catch(() => []);
  return { password: found.some((f) => f.value.password), captcha: found.some((f) => f.value.captcha) };
}

/**
 * Last step of a tool run: re-checks the site the tab ended up on (a redirect or link may have led somewhere blocked)
 * and queues the login / CAPTCHA hint. The content itself is sealed later, see seal().
 */
export async function finish(ctx: ToolCtx, tool: string, content: ToolContent[]): Promise<ToolContent[]> {
  if (ctx.tabId >= 0) {
    const tab = await chrome.tabs.get(ctx.tabId).catch(() => null);
    if (tab?.url) await siteGate(ctx, tab.url);
    // A page blocked by an open JS dialog cannot answer frame calls; skip the check until the dialog is handled.
    if (tool !== 'browser_request_user' && tab && !sessionOf(ctx.tabId)?.dialog) {
      const gates = await pageGates(ctx.tabId);
      if (gates.password || gates.captcha) ctx.notes.push(HANDBACK_HINT);
    }
  }
  return content;
}

/** Wraps what came from the page in the untrusted envelope and puts Helmsman's own notes in front, outside it. */
export function seal(content: ToolContent[], notes: string[]): ToolContent[] {
  const wrapped = content.map((c) => (c.type === 'text' ? { ...c, text: wrapUntrusted(c.text) } : c));
  return notes.length ? [{ type: 'text', text: notes.join('\n') }, ...wrapped] : wrapped;
}

/** A failure may quote the page (a script error, an element label); wrap it unless Helmsman wrote the message itself. */
export function failureText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof TrustedError || message === STOPPED ? message : wrapUntrusted(message);
}
