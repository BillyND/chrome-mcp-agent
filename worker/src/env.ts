import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { DeviceHub } from './device-hub';

export interface Env {
  OAUTH_KV: KVNamespace;
  HUB: DurableObjectNamespace<DeviceHub>;
  OAUTH_PROVIDER: OAuthHelpers;
  /** Public origin of this Worker, e.g. https://chrome-mcp-agent.example.workers.dev */
  PUBLIC_URL: string;
  /** Optional group password asked once when an extension connects. Unset means anyone with the extension. */
  ACCESS_PASSWORD?: string;
  /** 32+ random chars used to sign extension device tokens. */
  TOKEN_SECRET: string;
  /** "1" only under `wrangler dev` for the e2e suite: enables /dev routes. */
  DEV_MODE?: string;
}

export interface AuthProps extends Record<string, unknown> {
  device: string;
  /** Calling AI client: `<client name>#<OAuth client id>`. Missing on grants issued before agents were tracked. */
  agent?: string;
}
