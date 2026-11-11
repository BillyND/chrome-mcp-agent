// Tool arguments inside a saved workflow: refs become locators, literals can become parameters.
// Pure functions over JSON-like data.

import { describeLocator, type Locator } from '../../locator';

export type Json = unknown;

/** A step argument that stands for "the element described by this locator". */
export const LOCATOR_KEY = '$loc';
export interface LocatorArg {
  [LOCATOR_KEY]: Locator;
}

/** Argument names that hold element refs. */
const REF_KEYS = new Set(['ref', 'startRef', 'endRef', 'toRef']);

export const isLocatorArg = (v: unknown): v is LocatorArg => !!v && typeof v === 'object' && LOCATOR_KEY in v;

const isObject = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Replaces every ref argument with the result of `fn` (applied to each, in order). */
export async function mapRefs(value: Json, fn: (ref: string) => Promise<Json>): Promise<Json> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => mapRefs(v, fn)));
  if (!isObject(value)) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = REF_KEYS.has(key) && typeof v === 'string' ? await fn(v) : await mapRefs(v, fn);
  return out;
}

/** Replaces every locator argument with the ref `fn` finds for it. */
export async function resolveLocators(value: Json, fn: (loc: Locator) => Promise<string>): Promise<Json> {
  if (isLocatorArg(value)) return fn(value[LOCATOR_KEY]);
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolveLocators(v, fn)));
  if (!isObject(value)) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = await resolveLocators(v, fn);
  return out;
}

export const hasLocator = (value: Json): boolean => isLocatorArg(value) || (Array.isArray(value) ? value.some(hasLocator) : isObject(value) && Object.values(value).some(hasLocator));

/** Applies `fn` to every string except those inside locators. */
function mapStrings(value: Json, fn: (s: string) => string): Json {
  if (typeof value === 'string') return fn(value);
  if (isLocatorArg(value)) return value;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

const PARAM = /\{\{param:([A-Za-z0-9_]+)\}\}/g;
export const PARAM_NAME = /^[A-Za-z0-9_]{1,30}$/;

/** Fills {{param:name}} from `values`; throws naming the parameters that have no value. */
export function applyParams(value: Json, values: Record<string, string>): Json {
  const missing = new Set<string>();
  const out = mapStrings(value, (s) =>
    s.replace(PARAM, (_, name: string) => {
      if (Object.hasOwn(values, name)) return values[name];
      missing.add(name);
      return '';
    }),
  );
  if (missing.size) throw new Error(`Missing value for parameter ${[...missing].map((m) => `"${m}"`).join(', ')}.`);
  return out;
}

/** Turns the literal values used while recording into {{param:name}} placeholders; `used` lists the parameters that matched. */
export function parametrize(value: Json, params: Record<string, string>): { value: Json; used: string[] } {
  const used = new Set<string>();
  const out = mapStrings(value, (s) => {
    let result = s;
    for (const [name, literal] of Object.entries(params)) {
      if (literal && result.includes(literal)) {
        used.add(name);
        result = result.split(literal).join(`{{param:${name}}}`);
      }
    }
    return result;
  });
  return { value: out, used: [...used] };
}

/** A short human description of a step, e.g. `browser_click button "Tăng"`. */
export function stepLabel(tool: string, args: Record<string, Json>): string {
  const locator = (v: unknown) => (isLocatorArg(v) ? describeLocator(v[LOCATOR_KEY]) : undefined);
  const target = locator(args.ref) ?? locator(args.startRef) ?? locator(args.toRef) ?? (typeof args.element === 'string' ? args.element : undefined);
  const detail = typeof args.url === 'string' ? args.url : typeof args.text === 'string' ? JSON.stringify(args.text.slice(0, 40)) : typeof args.key === 'string' ? args.key : '';
  return [tool, target, detail].filter(Boolean).join(' ');
}
