import { AuthorizationError, CimdFetchError, OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { AUTH_PROTOCOL_PREFIX, PROTOCOL } from '../../shared/protocol';
import { signDeviceToken, verifyDeviceToken } from './device-token';
import { isAllowedEmail, type AuthProps, type Env } from './env';
import { exchangeGoogleCode, googleAuthorizeUrl, pkcePair } from './google';
import { handleMcp } from './mcp-server';
import { consentPage, escapeHtml, landingPage, messagePage } from './pages';

export { DeviceHub } from './device-hub';

/** Google `state` for the extension sign-in flow. `~` never appears in the library's own states. */
const EXT_STATE_PREFIX = '~ext~';
const EXTENSION_REDIRECT = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/[^#]*$/;

const html = (body: string, headers?: Headers) => {
  const h = headers ?? new Headers();
  h.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { headers: h });
};

// ---------- extension sign-in ------------------------------------------------

async function extensionLogin(url: URL, env: Env): Promise<Response> {
  const redirect = url.searchParams.get('redirect_uri') ?? '';
  const match = EXTENSION_REDIRECT.exec(redirect);
  const allowedIds = (env.EXTENSION_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!match || (allowedIds.length > 0 && !allowedIds.includes(match[1]))) {
    return messagePage('Không hợp lệ', 'Yêu cầu đăng nhập này không đến từ extension Chrome MCP Agent.');
  }
  const { verifier, challenge } = await pkcePair();
  const state = EXT_STATE_PREFIX + crypto.randomUUID();
  await env.OAUTH_KV.put(`ext-login:${state}`, JSON.stringify({ verifier, redirect }), { expirationTtl: 600 });
  return Response.redirect(googleAuthorizeUrl(env, state, challenge), 302);
}

async function extensionCallback(url: URL, env: Env, state: string): Promise<Response> {
  const saved = await env.OAUTH_KV.get<{ verifier: string; redirect: string }>(`ext-login:${state}`, 'json');
  if (!saved) return messagePage('Hết hạn', 'Phiên đăng nhập đã hết hạn. Bấm lại "Đăng nhập" trong extension.');
  await env.OAUTH_KV.delete(`ext-login:${state}`);
  const back = new URL(saved.redirect);
  const code = url.searchParams.get('code');
  if (!code) {
    back.hash = new URLSearchParams({ error: url.searchParams.get('error') ?? 'access_denied' }).toString();
    return Response.redirect(back.toString(), 302);
  }
  const user = await exchangeGoogleCode(env, code, saved.verifier);
  if (!isAllowedEmail(env, user.email)) {
    back.hash = new URLSearchParams({ error: 'not_allowed', email: user.email }).toString();
    return Response.redirect(back.toString(), 302);
  }
  const token = await signDeviceToken(env.TOKEN_SECRET, user.email);
  back.hash = new URLSearchParams({ token, email: user.email, name: user.name ?? '' }).toString();
  return Response.redirect(back.toString(), 302);
}

// ---------- extension WebSocket ---------------------------------------------

async function extensionSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  const token = protocols.find((p) => p.startsWith(AUTH_PROTOCOL_PREFIX))?.slice(AUTH_PROTOCOL_PREFIX.length);
  if (!protocols.includes(PROTOCOL) || !token) return new Response('Missing protocol', { status: 400 });
  const email = await verifyDeviceToken(env.TOKEN_SECRET, token);
  // Re-checking the allowlist here lets the owner revoke a friend by editing ALLOWED_EMAILS.
  if (!email || !isAllowedEmail(env, email)) return new Response('Unauthorized', { status: 401 });
  const headers = new Headers(request.headers);
  headers.set('x-cma-email', email);
  return env.HUB.get(env.HUB.idFromName(email)).fetch(new Request('https://hub/connect', { headers }));
}

// ---------- MCP authorization (ChatGPT signs in through us, we sign in through Google)

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === 'GET') {
    const authRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return html(consentPage({ ...details, handle: consent.handle }), consent.headers);
  }
  const form = await request.formData();
  const handle = String(form.get('handle') ?? '');
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    denied.headers.set('Location', denied.redirectTo);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const { verifier, challenge } = await pkcePair();
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  headers.set('Location', googleAuthorizeUrl(env, state, challenge));
  return new Response(null, { status: 302, headers });
}

async function mcpCallback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const url = new URL(request.url);
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
  const code = url.searchParams.get('code');
  if (!code) {
    const denied = new URL(original.redirectUri);
    denied.searchParams.set('error', 'access_denied');
    if (original.state) denied.searchParams.set('state', original.state);
    headers.set('Location', denied.toString());
    return new Response(null, { status: 302, headers });
  }
  const user = await exchangeGoogleCode(env, code, data.verifier);
  if (!isAllowedEmail(env, user.email)) {
    return messagePage('Tài khoản chưa được cho phép', `${user.email} chưa nằm trong danh sách được dùng Chrome MCP Agent. Nhờ chủ hệ thống thêm email này.`, false, 403);
  }
  const props: AuthProps = { email: user.email };
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: user.email,
    metadata: { name: user.name ?? user.email },
    scope: original.scope,
    props,
  });
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

// ---------- routing ----------------------------------------------------------

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/':
          return html(landingPage(env.PUBLIC_URL));
        case '/health':
          return Response.json({ ok: true });
        case '/authorize':
          return await authorize(request, env);
        case '/callback': {
          const state = url.searchParams.get('state') ?? '';
          return state.startsWith(EXT_STATE_PREFIX)
            ? await extensionCallback(url, env, state)
            : await mcpCallback(request, env);
        }
        case '/ext/login':
          return await extensionLogin(url, env);
        case '/ext/ws':
          return await extensionSocket(request, env);
        case '/ext/whoami': {
          const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
          const email = token ? await verifyDeviceToken(env.TOKEN_SECRET, token) : null;
          if (!email || !isAllowedEmail(env, email)) return new Response('Unauthorized', { status: 401 });
          return Response.json({ email });
        }
      }
      if (env.DEV_MODE === '1') {
        const email = url.searchParams.get('email') ?? '';
        if (url.pathname === '/dev/token') return new Response(await signDeviceToken(env.TOKEN_SECRET, email));
        if (url.pathname === '/dev/mcp') return await handleMcp(request, env, email);
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError) return messagePage('Không thể tiếp tục', error.description);
      if (error instanceof CimdFetchError) return messagePage('Không thể tiếp tục', 'Không xác minh được ứng dụng này.');
      console.error('request failed', url.pathname, error);
      return messagePage('Có lỗi xảy ra', `Thử lại sau ít phút. (${escapeHtml(String((error as Error)?.message ?? error))})`, false, 500);
    }
  },
};

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const email = (ctx.props as AuthProps | undefined)?.email;
    if (!email || !isAllowedEmail(env, email)) return new Response('Forbidden', { status: 403 });
    return handleMcp(request, env, email);
  },
};

const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(env: Env): OAuthProvider<Env> {
  let provider = providers.get(env.PUBLIC_URL);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpHandler,
      defaultHandler,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['browser', 'offline_access'],
      requiredScopes: ['browser'],
      accessTokenTTL: 3600,
      refreshTokenIdleTTL: 90 * 24 * 3600,
      resourceMetadata: {
        resource: `${env.PUBLIC_URL}/mcp`,
        authorization_servers: [env.PUBLIC_URL],
      },
      clientIdMetadataDocumentEnabled: true,
    });
    providers.set(env.PUBLIC_URL, provider);
  }
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return providerFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
