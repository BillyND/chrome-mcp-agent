// The last stop for every tool result before it leaves the extension: secrets are hidden, then the
// output budget is applied. Doing it here, in one place, means no tool can forget either.

import type { ToolContent } from '../../../../shared/protocol';
import { redactSecrets } from '../secrets/redact';
import { loadSecrets } from '../secrets/store';
import { limitFor, truncateWithHandle } from './limit';

export async function protectContent(content: ToolContent[], agent: string, args: { maxChars?: unknown }): Promise<ToolContent[]> {
  const secrets = await loadSecrets();
  const limit = limitFor(args);
  return content.map((item) =>
    item.type === 'text' ? { type: 'text', text: truncateWithHandle(agent, redactSecrets(item.text, secrets), limit).text } : item,
  );
}
