// Human-facing identity of an agent: the short label and colour of its tab group.
// Pure functions so they can be unit tested.

export const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const DEFAULT_AGENT = 'default';

const clip = (s: string) => s.trim().slice(0, 14) || 'agent';

/**
 * Ids look like `local:claude-code` (local server), `ChatGPT#<client id>` (cloud gateway) or an
 * arbitrary string; the label is the part a person recognises.
 */
export function agentLabel(agent: string): string {
  if (agent === DEFAULT_AGENT) return 'AI';
  if (agent.startsWith('local:')) return clip(agent.slice(6));
  const hash = agent.indexOf('#');
  return clip(hash > 0 ? agent.slice(0, hash) : agent);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A stable colour per agent, skipping colours other agents already use while some remain free. */
export function pickColor(agent: string, taken: readonly string[]): GroupColor {
  const start = hash(agent) % GROUP_COLORS.length;
  for (let i = 0; i < GROUP_COLORS.length; i++) {
    const color = GROUP_COLORS[(start + i) % GROUP_COLORS.length];
    if (!taken.includes(color)) return color;
  }
  return GROUP_COLORS[start];
}
