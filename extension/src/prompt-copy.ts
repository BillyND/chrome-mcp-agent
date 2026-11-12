// What a confirmation says, shared by the on-page prompt and the popup so both use the same words:
// a readable agent name, the title and detail line, and the label and look of each button.

import { t, tf, type Key, type Lang } from './i18n';
import type { Choice, PromptSpec } from './messages';

const NAME_MAX = 30;

/**
 * Turns an agent id into a name a person recognises: "claude-code" -> "Claude Code", "local:cursor" -> "Cursor",
 * "ChatGPT#9f8e7d" -> "ChatGPT", "default" -> "AI". Names that already have capitals are left as written.
 */
export function agentName(agent: string): string {
  const id = agent.trim();
  if (!id || id === 'default') return 'AI';
  const bare = (id.startsWith('local:') ? id.slice(6) : id.indexOf('#') > 0 ? id.slice(0, id.indexOf('#')) : id).trim();
  const name = /[A-Z\s]/.test(bare) ? bare : bare.split(/[-_.]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return name.slice(0, NAME_MAX) || 'AI';
}

export function promptCopy(lang: Lang, spec: PromptSpec): { title: string; detail: string } {
  const params = { agent: agentName(spec.agent), host: spec.host, label: spec.label, reason: spec.label, category: t(lang, `cat_${spec.category}` as Key) };
  return { title: tf(lang, `prompt_${spec.kind}` as Key, params), detail: tf(lang, `prompt_${spec.kind}_detail` as Key, params) };
}

export function choiceLabel(lang: Lang, spec: PromptSpec, choice: Choice): string {
  return t(lang, (spec.kind === 'handback' && choice === 'decline' ? 'choice_cancel' : `choice_${choice}`) as Key);
}

/** The filled button of a prompt: the answer most people want. */
export const isPrimary = (choice: Choice): boolean => choice === 'always' || choice === 'approve' || choice === 'done';
