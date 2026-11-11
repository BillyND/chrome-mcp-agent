// Stable element references for this frame. An element keeps its ref for as
// long as it stays in the document, so refs from an earlier snapshot keep
// working after the page changes around them.

let counter = 0;
const byRef = new Map<string, WeakRef<Element>>();
const refOf = new WeakMap<Element, string>();

export function refFor(el: Element): string {
  let ref = refOf.get(el);
  if (!ref) {
    ref = `e${++counter}`;
    refOf.set(el, ref);
    byRef.set(ref, new WeakRef(el));
  }
  return ref;
}

export function resolveRef(ref: string): Element {
  const el = byRef.get(ref)?.deref();
  if (!el || !el.isConnected) {
    throw new Error(`Element ${ref} is no longer on the page. Take a new browser_snapshot and use the new ref.`);
  }
  return el;
}

/** Drops refs of elements that left the document so the map stays small. */
export function pruneRefs(): void {
  for (const [ref, weak] of byRef) {
    const el = weak.deref();
    if (!el || !el.isConnected) byRef.delete(ref);
  }
}
