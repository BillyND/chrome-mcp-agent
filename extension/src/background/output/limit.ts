// The output budget: no tool result is longer than MAX_OUTPUT_CHARS. Longer text is cut (at a
// line break when possible), the full text is kept under a handle, and the note at the end tells
// the model how to continue with browser_read_more.

import { MAX_OUTPUT_CHARS } from '../../../../shared/tools';
import { handles, type HandleStore } from './handles';

/** Room kept for the notes this module adds. */
export const NOTE_RESERVE = 300;
const MIN_LIMIT = 1000;

/** The budget for one call: its own maxChars when it has one, never more than the global maximum. */
export function limitFor(args: { maxChars?: unknown }): number {
  const asked = Number(args.maxChars);
  return Math.min(MAX_OUTPUT_CHARS, Math.max(MIN_LIMIT, Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : MAX_OUTPUT_CHARS));
}

/** End index for a piece of `text` starting at `from` and at most `size` long, preferring a line break. */
export function cutPoint(text: string, from: number, size: number): number {
  const hard = Math.min(text.length, from + size);
  if (hard >= text.length) return text.length;
  const newline = text.lastIndexOf('\n', hard - 1);
  return newline > from + size * 0.7 ? newline : hard;
}

const continueNote = (handle: string, end: number, total: number, start = 0) =>
  `… [truncated: showing characters ${start}-${end} of ${total}. Continue with browser_read_more {"handle":"${handle}","offset":${end}}]`;

export interface Limited {
  text: string;
  truncated: boolean;
  /** How many characters of the original are in `text` (before the note). */
  shown: number;
}

/** `text` as is when it fits in `limit` characters, else its start plus a note, with the whole text kept under a handle. */
export function truncateWithHandle(agent: string, text: string, limit: number, store: HandleStore = handles): Limited {
  if (text.length <= limit) return { text, truncated: false, shown: text.length };
  const end = cutPoint(text, 0, Math.max(0, limit - NOTE_RESERVE));
  const handle = store.put(agent, text);
  return { text: `${text.slice(0, end)}\n${continueNote(handle, end, text.length)}`, truncated: true, shown: end };
}

/** The next chunk of a kept text, or undefined when the handle is unknown (expired or another agent's). */
export function readChunk(agent: string, handle: string, offset: number, limit: number, store: HandleStore = handles): string | undefined {
  const text = store.get(agent, handle);
  if (text === undefined) return undefined;
  if (offset >= text.length) return `Offset ${offset} is past the end of the text (${text.length} characters).`;
  const end = cutPoint(text, offset, Math.max(0, limit - NOTE_RESERVE));
  const head = `Characters ${offset}-${end} of ${text.length}:`;
  const tail = end < text.length ? continueNote(handle, end, text.length, offset) : '[end of text]';
  return `${head}\n${text.slice(offset, end)}\n${tail}`;
}
