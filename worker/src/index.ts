import { AuthorizationError, CimdFetchError, OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { AUTH_PROTOCOL_PREFIX, PROTOCOL } from '../../shared/protocol';
import { signDeviceToken, verifyDeviceToken } from './device-token';
import type { AuthProps, Env } from './env';
import { handleMcp } from './mcp-server';
import { consentPage, escapeHtml, landingPage, messagePage, privacyPage } from './pages';
import { deviceForCode, forgetDevice, isActiveDevice, passwordRequired, registerDevice } from './pairing';

export { DeviceHub } from './device-hub';

/** Wrong connection codes allowed per IP per 10 minutes on the consent page. */
const MAX_CODE_ATTEMPTS = 20;

const html = (body: string, headers?: Headers, status = 200) => {
  const h = headers ?? new Headers();
  h.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { status, headers: h });
};

async function deviceFromBearer(request: Request, env: Env): Promise<string | null> {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const device = token ? await verifyDeviceToken(env.TOKEN_SECRET, token) : null;
  return device && (await isActiveDevice(env, device)) ? device : null;
}

// ---------- extension --------------------------------------------------------

async function extensionRegister(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return Response.json({ passwordRequired: passwordRequired(env) });
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const result = await registerDevice(env, String(body.password ?? ''));
  if (!result.ok) return Response.json(result, { status: 403 });
  return Response.json(result);
}

async function extensionSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  const token = protocols.find((p) => p.startsWith(AUTH_PROTOCOL_PREFIX))?.slice(AUTH_PROTOCOL_PREFIX.length);
  if (!protocols.includes(PROTOCOL) || !token) return new Response('Missing protocol', { status: 400 });
  const device = await verifyDeviceToken(env.TOKEN_SECRET, token);
  if (!device || !(await isActiveDevice(env, device))) return new Response('Unauthorized', { status: 401 });
  const headers = new Headers(request.headers);
  headers.set('x-cma-device', device);
  return env.HUB.get(env.HUB.idFromName(device)).fetch(new Request('https://hub/connect', { headers }));
}

// ---------- MCP authorization: the user proves which Chrome is theirs with its connection code

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

  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const triesKey = `code-tries:${ip}`;
  const tries = Number((await env.OAUTH_KV.get(triesKey)) ?? 0);
  if (tries >= MAX_CODE_ATTEMPTS) {
    return messagePage('Thử quá nhiều lần', 'Bạn đã nhập sai mã quá nhiều lần. Đợi 10 phút rồi thử lại.', false, 429);
  }
  const device = await deviceForCode(env, String(form.get('code') ?? ''));
  if (!device) {
    await env.OAUTH_KV.put(triesKey, String(tries + 1), { expirationTtl: 600 });
    // The handle is still unused, so the same page can be shown again with the error.
    const view = {
      clientName: String(form.get('client_name') ?? 'ChatGPT'),
      redirectHost: String(form.get('redirect_host') ?? ''),
      redirectIsLoopback: form.get('redirect_loopback') === '1',
      clientDomain: String(form.get('client_domain') ?? '') || undefined,
      handle,
      error: 'Mã kết nối không đúng. Mở extension Helmsman để xem lại mã của bạn.',
    };
    return html(consentPage(view), undefined, 400);
  }

  const approved = await oauth.approveConsent(request, handle);
  const clientName = String(form.get('client_name') ?? '').replace(/[#\n\r]/g, ' ').trim().slice(0, 24) || 'AI';
  const props: AuthProps = { device, agent: `${clientName}#${approved.request.clientId}` };
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: device,
    metadata: {},
    scope: approved.request.scope,
    props,
  });
  approved.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

// ---------- routing ----------------------------------------------------------

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/':
          return html(landingPage(env.PUBLIC_URL));
        case '/privacy':
          return html(privacyPage());
        case '/health':
          return Response.json({ ok: true });
        case '/authorize':
          return await authorize(request, env);
        case '/ext/register':
          return await extensionRegister(request, env);
        case '/ext/ws':
          return await extensionSocket(request, env);
        case '/ext/whoami': {
          const device = await deviceFromBearer(request, env);
          return device ? Response.json({ ok: true }) : new Response('Unauthorized', { status: 401 });
        }
        case '/ext/forget': {
          const device = await deviceFromBearer(request, env);
          if (device) await forgetDevice(env, device);
          return Response.json({ ok: true });
        }
      }
      if (env.DEV_MODE === '1') {
        const device = url.searchParams.get('device') ?? '';
        if (url.pathname === '/dev/token') {
          await env.OAUTH_KV.put(`device:${device}`, 'dev');
          return new Response(await signDeviceToken(env.TOKEN_SECRET, device));
        }
        if (url.pathname === '/dev/mcp') return await handleMcp(request, env, device, url.searchParams.get('agent') ?? undefined);
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
    const { device, agent } = (ctx.props as AuthProps | undefined) ?? {};
    // Whether the device is still registered is checked by its Durable Object on each tool call
    // (cached there), which saves a KV read on every MCP request.
    if (!device) return new Response('Unauthorized', { status: 401 });
    return handleMcp(request, env, device, agent);
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
      // Revoking a Chrome is enforced per call by its Durable Object, so access tokens can live a week: far
      // fewer refreshes, and each refresh costs KV writes (1,000 a day on the free plan).
      accessTokenTTL: 7 * 24 * 3600,
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
