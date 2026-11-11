// Robust element locators for saved workflows: what an element is (role + accessible name + a few
// stable attributes) and which frame it lives in, instead of a ref that dies with the page.
// Pure functions shared by the content script (scoring), the background (choosing) and the tests.

export interface Fingerprint {
  role: string;
  name: string;
  tag: string;
  inputType?: string;
  id?: string;
  testId?: string;
  /** The `name` attribute of form controls. */
  field?: string;
  placeholder?: string;
}

export interface Locator extends Fingerprint {
  /** Position among the elements of its frame sharing role and name, to tell "Delete" buttons apart. */
  nth: number;
  /** URL path of each non-top frame from the top page down to the element's frame. */
  frame: string[];
}

/** A page element that may be the one the locator describes. */
export interface Candidate {
  ref: string;
  /** scoreMatch of the element against the locator. */
  score: number;
  nth: number;
  frame: string[];
}

/** Below this score (out of 100) an element is not the one we were looking for. */
export const MATCH_THRESHOLD = 55;

export const normalize = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const words = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 1 for equal names, high when one contains the other, else the word overlap (Dice coefficient). */
export function similarity(a: string | undefined, b: string | undefined): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const wa = words(x);
  const wb = words(y);
  if (!wa.length || !wb.length) return 0;
  const shared = wa.filter((w) => wb.includes(w)).length;
  return (2 * shared) / (wa.length + wb.length);
}

/** How well an element matches a locator, 0-100 (frame and position are judged by pickBest). */
export function scoreMatch(want: Fingerprint, have: Fingerprint): number {
  if (want.role !== have.role) return 0;
  let score = 30;
  score += (want.name || have.name ? 50 * similarity(want.name, have.name) : 20);
  if (want.tag === have.tag) score += 5;
  if (want.inputType && want.inputType === have.inputType) score += 3;
  if (want.testId && want.testId === have.testId) score += 25;
  if (want.field && want.field === have.field) score += 10;
  if (want.id && want.id === have.id) score += 8;
  if (want.placeholder && want.placeholder === have.placeholder) score += 4;
  return Math.min(100, score);
}

/** 0..1: how well the candidate's frame path matches the recorded one (same length and same paths is 1). */
export function frameScore(want: string[], have: string[]): number {
  if (!want.length && !have.length) return 1;
  const same = want.filter((p, i) => have[i] === p).length;
  return same / Math.max(want.length, have.length);
}

/** The most likely element, or undefined when nothing is a convincing match. */
export function pickBest(want: Locator, candidates: Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  let bestTotal = -1;
  for (const c of candidates) {
    if (c.score < MATCH_THRESHOLD) continue;
    const total = c.score + 20 * frameScore(want.frame, c.frame) + (c.nth === want.nth ? 5 : 0);
    if (total > bestTotal) {
      best = c;
      bestTotal = total;
    }
  }
  return best;
}

/** Short text for messages, e.g. `button "Tăng"`. */
export const describeLocator = (l: Pick<Fingerprint, 'role' | 'name' | 'tag'>): string => `${l.role === 'generic' ? l.tag : l.role}${l.name ? ` "${l.name}"` : ''}`;

/** A frame's address without query or fragment, so the same embed matches across visits. */
export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) ? u.origin + u.pathname : url;
  } catch {
    return url;
  }
}

/** Frame path of `frameId`: the URL path of each frame from just below the top page down to it. */
export function framePathOf(frames: Array<{ frameId: number; parentFrameId: number; url: string }>, frameId: number): string[] {
  const byId = new Map(frames.map((f) => [f.frameId, f]));
  const path: string[] = [];
  for (let cur = byId.get(frameId), i = 0; cur && cur.frameId !== 0 && i < 20; cur = byId.get(cur.parentFrameId), i++) path.unshift(urlPath(cur.url));
  return path;
}
