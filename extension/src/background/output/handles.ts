// Full text of tool results that were cut to fit the output budget, kept in the extension
// (never sent to the model) so browser_read_more can page through it. Handles belong to the
// agent that produced them.

const MAX_ENTRIES = 16;
const MAX_TOTAL_CHARS = 16_000_000;

export class HandleStore {
  private entries = new Map<string, { agent: string; text: string }>();
  private counter = 0;
  private total = 0;

  put(agent: string, text: string): string {
    const id = `h${++this.counter}`;
    this.entries.set(id, { agent, text });
    this.total += text.length;
    // Oldest first: Map keeps insertion order.
    for (const [old, entry] of this.entries) {
      if (this.entries.size <= MAX_ENTRIES && this.total <= MAX_TOTAL_CHARS) break;
      if (old === id) break;
      this.entries.delete(old);
      this.total -= entry.text.length;
    }
    return id;
  }

  get(agent: string, id: string): string | undefined {
    const entry = this.entries.get(id);
    return entry && entry.agent === agent ? entry.text : undefined;
  }
}

export const handles = new HandleStore();
