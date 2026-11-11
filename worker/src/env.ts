import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { DeviceHub } from './device-hub';

export interface Env {
  OAUTH_KV: KVNamespace;
  HUB: DurableObjectNamespace<DeviceHub>;
  OAUTH_PROVIDER: OAuthHelpers;
  /** Public origin of this Worker, e.g. https://chrome-mcp-agent.example.workers.dev */
  PUBLIC_URL: string;
  /** Comma separated Google accounts that may sign in. Empty means nobody. */
  ALLOWED_EMAILS: string;
  /** Comma separated extension IDs allowed to receive device tokens. Empty allows any. */
  EXTENSION_IDS?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 32+ random chars used to sign extension device tokens. */
  TOKEN_SECRET: string;
  /** "1" only under `wrangler dev` for the e2e suite: enables /dev routes. */
  DEV_MODE?: string;
}

export interface AuthProps extends Record<string, unknown> {
  email: string;
}

export function isAllowedEmail(env: Env, email: string): boolean {
  const allowed = env.ALLOWED_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}
