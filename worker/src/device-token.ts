// Long-lived HMAC tokens that let a signed-in extension open its WebSocket.
// Format: base64url(payload).base64url(signature) — short, header-safe, no deps.

const enc = new TextEncoder();
const DEVICE_TOKEN_TTL_SECONDS = 180 * 24 * 3600;

interface DeviceTokenPayload {
  sub: string; // email
  iat: number;
  exp: number;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signDeviceToken(secret: string, email: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload: DeviceTokenPayload = { sub: email.toLowerCase(), iat, exp: iat + DEVICE_TOKEN_TTL_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

/** Returns the email for a valid, unexpired token, otherwise null. */
export async function verifyDeviceToken(secret: string, token: string, now = Date.now()): Promise<string | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as DeviceTokenPayload;
    if (typeof payload.sub !== 'string' || payload.exp * 1000 < now) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
