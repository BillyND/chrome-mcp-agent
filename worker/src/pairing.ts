// Devices and connection codes. An extension registers once and gets a device
// token (for its WebSocket) plus a short connection code the user pastes into
// the consent page when ChatGPT connects. The code is what ties a ChatGPT
// account to one Chrome.

import { signDeviceToken } from './device-token';
import type { Env } from './env';

// No 0/O, 1/I/L: easy to read aloud and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10; // ~49 bits

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Accepts codes typed with spaces, lowercase or without the dash. */
export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== CODE_LENGTH || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Constant-time string comparison for the group password. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function passwordRequired(env: Env): boolean {
  return !!env.ACCESS_PASSWORD;
}

export async function registerDevice(
  env: Env,
  password: string,
): Promise<{ ok: true; token: string; code: string } | { ok: false; error: 'password_required' | 'wrong_password' }> {
  if (env.ACCESS_PASSWORD) {
    if (!password) return { ok: false, error: 'password_required' };
    if (!sameSecret(password, env.ACCESS_PASSWORD)) return { ok: false, error: 'wrong_password' };
  }
  const device = crypto.randomUUID();
  const code = newCode();
  await env.OAUTH_KV.put(`pair:${code}`, device);
  await env.OAUTH_KV.put(`device:${device}`, code);
  return { ok: true, token: await signDeviceToken(env.TOKEN_SECRET, device), code };
}

export async function deviceForCode(env: Env, input: string): Promise<string | null> {
  const code = normalizeCode(input);
  return code ? env.OAUTH_KV.get(`pair:${code}`) : null;
}

export async function isActiveDevice(env: Env, device: string): Promise<boolean> {
  return (await env.OAUTH_KV.get(`device:${device}`)) !== null;
}

/** Signing out of the extension retires its code, so ChatGPT links made with it stop working. */
export async function forgetDevice(env: Env, device: string): Promise<void> {
  const code = await env.OAUTH_KV.get(`device:${device}`);
  if (code) await env.OAUTH_KV.delete(`pair:${code}`);
  await env.OAUTH_KV.delete(`device:${device}`);
}
