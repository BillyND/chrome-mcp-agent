// What each agent has already seen of each tab: the lines of its last snapshot (per kind of view),
// the base a later diff is computed against. Held in memory only; lost state simply means "full".

export interface Baseline {
  url: string;
  lines: string[];
}

const MAX_BASELINES = 64;

export class Baselines {
  private map = new Map<string, Baseline>();

  private key = (tabId: number, agent: string, view: string) => `${tabId}\u0000${agent}\u0000${view}`;

  get(tabId: number, agent: string, view: string): Baseline | undefined {
    return this.map.get(this.key(tabId, agent, view));
  }

  set(tabId: number, agent: string, view: string, baseline: Baseline): void {
    const key = this.key(tabId, agent, view);
    this.map.delete(key); // re-insert: most recently used last
    this.map.set(key, baseline);
    if (this.map.size > MAX_BASELINES) this.map.delete(this.map.keys().next().value!);
  }

  /** Forget everything about a tab (it navigated or closed). */
  clearTab(tabId: number): void {
    const prefix = `${tabId}\u0000`;
    for (const key of this.map.keys()) if (key.startsWith(prefix)) this.map.delete(key);
  }
}

export const baselines = new Baselines();
