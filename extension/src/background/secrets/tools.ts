// Using secrets from tools: typing placeholders, refusing them everywhere else, listing names.

import { freeTool, text, ToolError } from '../tools/types';
import { hasPlaceholder, substituteSecrets } from './redact';
import { loadSecrets } from './store';

/** Tools whose text input may carry {{secret:NAME}}; any other tool refuses it (URLs, scripts, cookies...). */
const SECRET_TOOLS = new Set(['browser_type', 'browser_fill_form']);

/** Throws when a tool that must not see secrets was handed a placeholder. */
export function assertSecretsAllowed(tool: string, args: unknown): void {
  if (SECRET_TOOLS.has(tool) || !hasPlaceholder(JSON.stringify(args))) return;
  throw new ToolError(`{{secret:NAME}} can only be used in browser_type and browser_fill_form, not in ${tool}: secrets are never put into URLs, scripts or other tool input.`);
}

/** The text to type: placeholders replaced by the stored values. The original string is what results may show. */
export async function resolveSecrets(value: string): Promise<string> {
  if (!hasPlaceholder(value)) return value;
  try {
    return substituteSecrets(value, await loadSecrets());
  } catch (e) {
    throw new ToolError((e as Error).message);
  }
}

export const secretsTools = {
  browser_secrets_list: freeTool(async () => {
    const names = Object.keys(await loadSecrets());
    return text(
      names.length
        ? `Saved secrets (values are hidden): ${names.join(', ')}.\nType one with {{secret:NAME}} in browser_type or browser_fill_form text.`
        : 'No secrets saved. Ask the user to add them in the Helmsman popup (Secrets), then use {{secret:NAME}} in browser_type or browser_fill_form.',
    );
  }),
};
