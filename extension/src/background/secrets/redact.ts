// Secret placeholders and redaction. Pure functions: the real values only ever meet text here,
// in the extension, never in anything sent to the model.

export type Secrets = Record<string, string>;

export const SECRET_NAME = /^[A-Za-z0-9_.-]{1,40}$/;
/** Values shorter than this would redact ordinary words, so they are not accepted. */
export const MIN_SECRET_LENGTH = 3;

const PLACEHOLDER = /\{\{secret:([A-Za-z0-9_.-]{1,40})\}\}/g;

export const placeholderOf = (name: string) => `{{secret:${name}}}`;

export const hasPlaceholder = (text: string): boolean => /\{\{secret:/.test(text);

export function isValidSecret(name: string, value: string): boolean {
  return SECRET_NAME.test(name) && value.length >= MIN_SECRET_LENGTH;
}

/** Replaces {{secret:NAME}} with the stored value. Throws naming the secrets that do not exist. */
export function substituteSecrets(text: string, secrets: Secrets): string {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_, name: string) => {
    if (Object.hasOwn(secrets, name)) return secrets[name];
    missing.add(name);
    return '';
  });
  if (missing.size) {
    const known = Object.keys(secrets);
    throw new Error(
      `Unknown secret ${[...missing].map((n) => `"${n}"`).join(', ')}. ${known.length ? `Saved secrets: ${known.join(', ')}.` : 'The user has not saved any secrets yet (popup > Secrets).'}`,
    );
  }
  return out;
}

const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);

/** The ways a value can show up in output: as is, in JSON (also JSON inside JSON), in a URL (also encoded twice), in HTML. */
function variants(value: string): string[] {
  const forms = new Set([value, encodeURI(value), value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')]);
  let json = value;
  let uri = value;
  for (let level = 0; level < 3; level++) {
    json = jsonEscape(json);
    uri = encodeURIComponent(uri);
    forms.add(json);
    forms.add(uri);
  }
  return [...forms].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces every occurrence of a secret value with its {{secret:NAME}} placeholder (one pass, longest match first). */
export function redactSecrets(text: string, secrets: Secrets): string {
  const byVariant = new Map<string, string>();
  for (const [name, value] of Object.entries(secrets)) {
    if (value.length < MIN_SECRET_LENGTH) continue;
    for (const v of variants(value)) if (!byVariant.has(v)) byVariant.set(v, name);
  }
  if (!byVariant.size) return text;
  const pattern = new RegExp([...byVariant.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g');
  return text.replace(pattern, (hit) => placeholderOf(byVariant.get(hit)!));
}

/** Redacts every string inside JSON-like data (used on recorded workflow arguments). */
export function redactDeep<T>(data: T, secrets: Secrets): T {
  if (typeof data === 'string') return redactSecrets(data, secrets) as T;
  if (Array.isArray(data)) return data.map((d) => redactDeep(d, secrets)) as T;
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, redactDeep(v, secrets)])) as T;
  return data;
}
