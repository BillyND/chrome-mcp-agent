// DOM side of workflow locators: describe an element by role and name, and find the
// elements of this frame that match a recorded description.

import { type Fingerprint, MATCH_THRESHOLD, normalize, scoreMatch } from '../locator';
import { accessibleName, isVisible, roleOf, shadowRootOf } from './dom';
import { refFor, resolveRef } from './refs';

const roleFor = (el: Element) => roleOf(el) ?? 'generic';

export function fingerprintOf(el: Element): Fingerprint {
  const input = el instanceof HTMLInputElement ? el : undefined;
  return {
    role: roleFor(el),
    name: accessibleName(el).slice(0, 120),
    tag: el.localName,
    inputType: input?.type,
    id: el.id || undefined,
    testId: el.getAttribute('data-testid') ?? el.getAttribute('data-test-id') ?? el.getAttribute('data-test') ?? undefined,
    field: el.getAttribute('name') ?? undefined,
    placeholder: el.getAttribute('placeholder') ?? undefined,
  };
}

/** Every element of the document, open and closed shadow roots included, in document order. */
function* allElements(root: ParentNode): Generator<Element> {
  for (const el of root.querySelectorAll('*')) {
    yield el;
    const shadow = shadowRootOf(el);
    if (shadow) yield* allElements(shadow);
  }
}

/** Elements whose role is `role`, in document order. Roles are cheap; names are only computed for these. */
const withRole = (role: string): Element[] => [...allElements(document)].filter((el) => roleFor(el) === role);

/** The description of the element behind `ref`, with its position among elements of the same role and name. */
export function describeRef(ref: string): Fingerprint & { nth: number } {
  const el = resolveRef(ref);
  const fp = fingerprintOf(el);
  const same = withRole(fp.role).filter((other) => normalize(accessibleName(other)) === normalize(fp.name));
  return { ...fp, nth: Math.max(0, same.indexOf(el)) };
}

export interface FoundElement {
  ref: string;
  score: number;
  nth: number;
}

/** Visible elements of this frame that look like `want`, best first (at most 8). */
export function findByLocator(want: Fingerprint, prefix: string): FoundElement[] {
  const wantName = normalize(want.name);
  const sameName: Element[] = [];
  const found: Array<{ el: Element; score: number }> = [];
  for (const el of withRole(want.role)) {
    if (!isVisible(el)) continue;
    const fp = fingerprintOf(el);
    if (normalize(fp.name) === wantName) sameName.push(el);
    const score = scoreMatch(want, fp);
    if (score >= MATCH_THRESHOLD) found.push({ el, score });
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ el, score }) => ({ ref: prefix + refFor(el), score, nth: Math.max(0, sameName.indexOf(el)) }));
}
