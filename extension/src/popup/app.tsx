import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getPrefs, isDark, setPrefs, t, type Key, type Prefs } from '../i18n';
import type { PopupState, RuntimeMessage } from '../messages';
import { SecretsSection } from './secrets-section';
import { Badge, Button, Card, Input, Switch, ToggleGroup, ToggleGroupItem } from './ui/components';
import { cn } from './ui/utils';

const send = <T = unknown,>(msg: RuntimeMessage) => chrome.runtime.sendMessage(msg) as Promise<T>;

const Icon = {
  logo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3l7 17 2.5-7L21 10.5z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
};

const DOT: Record<string, string> = {
  off: 'bg-muted-foreground',
  connected: 'bg-success',
  connecting: 'bg-warning animate-pulse',
  offline: 'bg-warning animate-pulse',
  replaced: 'bg-warning',
  'not-allowed': 'bg-destructive',
  paused: 'bg-destructive',
  'signed-out': 'bg-muted-foreground',
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? Icon.check : Icon.copy}
    </Button>
  );
}

/** One-line client config for the local MCP server (the port only appears when it is not the default). */
function localSnippet(port: number): string {
  const server: Record<string, unknown> = { command: 'npx', args: ['-y', 'helmsman-mcp'] };
  if (port !== 47821) server.env = { HELMSMAN_PORT: String(port) };
  return JSON.stringify({ mcpServers: { helmsman: server } });
}

function timeAgo(ts: number, lang: string): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return new Date(ts).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

function App() {
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [s, setState] = useState<PopupState | null>(null);
  const [password, setPassword] = useState('');

  const refresh = useCallback(async () => setState(await send<PopupState>({ type: 'get-state' })), []);

  useEffect(() => {
    void getPrefs().then(setPrefsState);
    void refresh();
    const onMsg = (m: { type?: string }) => m?.type === 'state-changed' && void refresh();
    chrome.runtime.onMessage.addListener(onMsg);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!prefs) return;
    const apply = () => document.documentElement.classList.toggle('dark', isDark(prefs.theme));
    apply();
    document.documentElement.lang = prefs.lang;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs]);

  if (!prefs || !s) return null;
  const tr = (k: Key) => t(prefs.lang, k);
  const update = async (next: Partial<Prefs>) => setPrefsState(await setPrefs(next));

  const signedIn = !!s.code;
  const active = signedIn || s.local.enabled;
  const localUp = s.local.status === 'connected';
  // The header shows the cloud connection, or the local one when that is all the user uses.
  const headerStatus = s.status === 'connected' || localUp ? 'connected' : signedIn || !s.local.enabled ? s.status : s.local.status;
  const statusKey = active && s.paused ? 'paused' : headerStatus;
  const statusText = active && s.paused ? tr('paused') : tr(`status_${headerStatus}` as Key);
  const localText = s.local.status === 'connecting' ? tr('localWaiting') : tr(`status_${s.local.status}` as Key);
  const snippet = localSnippet(s.local.port);
  const error = s.lastError ? tr(`err_${s.lastError}` as Key) : '';
  const mcpUrl = `${s.gateway}/mcp`;
  const busy = s.status === 'connecting';

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <header className="flex items-center gap-2">
        <div className="grid size-6.5 place-items-center rounded-md bg-primary text-primary-foreground [&_svg]:size-4">{Icon.logo}</div>
        <b className="flex-1 text-[15px] font-semibold">Helmsman</b>
        <Badge id="status">
          <i className={cn('size-1.5 rounded-full', DOT[statusKey])} />
          <span id="status-text">{statusText}</span>
        </Badge>
      </header>

      {!signedIn ? (
        <section id="signed-out" className="flex flex-col gap-2.5">
          <p className="text-[15px] text-muted-foreground">{tr('tagline')}</p>
          {s.needsPassword && (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              {tr('password')}
              <Input
                id="password"
                type="password"
                value={password}
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send({ type: 'connect', password })}
              />
            </label>
          )}
          <Button id="login" className="w-full" disabled={busy} onClick={() => void send({ type: 'connect', password })}>
            {busy ? tr('connecting') : tr('connect')}
          </Button>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </section>
      ) : (
        <section id="signed-in" className="flex flex-col gap-2.5">
          <Card>
            <div className="mb-1 text-[13px] font-medium text-muted-foreground">{tr('code')}</div>
            <div className="flex items-center justify-between gap-2">
              <code id="code" className="font-mono text-xl font-semibold tracking-wider">
                {s.code}
              </code>
              <CopyButton value={s.code!} label={tr('copy')} />
            </div>
          </Card>

          <Card>
            <div className="mb-1 flex items-center justify-between text-[13px] font-medium text-muted-foreground">
              {tr('mcpUrl')}
              <a className="underline-offset-4 hover:text-foreground hover:underline" href={s.gateway} target="_blank" rel="noreferrer">
                {tr('howTo')}
              </a>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span id="mcp-url" className="min-w-0 truncate font-mono text-[13px]" title={mcpUrl}>
                {mcpUrl}
              </span>
              <CopyButton value={mcpUrl} label={tr('copy')} />
            </div>
          </Card>

          {error && s.status !== 'connected' && <p className="text-[13px] text-destructive">{error}</p>}
          {s.status === 'replaced' && (
            <Button id="use-here" className="w-full" onClick={() => void send({ type: 'reconnect' })}>
              {tr('useHere')}
            </Button>
          )}
        </section>
      )}

      <Card id="local" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="local-enabled" className="text-[15px] font-medium">
            {tr('localMode')}
          </label>
          <div className="flex items-center gap-2">
            {s.local.enabled && (
              <span id="local-status" data-status={s.local.status} className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <i className={cn('size-1.5 rounded-full', DOT[s.local.status])} />
                {localText}
              </span>
            )}
            <Switch id="local-enabled" checked={s.local.enabled} onCheckedChange={(enabled) => void send({ type: 'set-local', enabled })} />
          </div>
        </div>
        {s.local.enabled && (
          <>
            <div className="text-[13px] text-muted-foreground">{tr('localHint')}</div>
            <div className="flex items-center justify-between gap-2">
              <code id="local-config" className="min-w-0 truncate font-mono text-[13px]" title={snippet}>
                {snippet}
              </code>
              <CopyButton value={snippet} label={tr('copy')} />
            </div>
          </>
        )}
      </Card>

      {active && (
        <Card className="flex items-center justify-between">
          <label htmlFor="enabled" className="text-[15px] font-medium">
            {tr('allow')}
          </label>
          <Switch id="enabled" checked={!s.paused} onCheckedChange={(on) => void send({ type: on ? 'resume' : 'stop' })} />
        </Card>
      )}

      <SecretsSection lang={prefs.lang} />

      {active && (
        <>
        <div className="mt-0.5 text-[13px] font-medium text-muted-foreground">{tr('activity')}</div>
        <ul id="log" className="divide-y rounded-lg border">
          {s.log.length === 0 && <li className="px-2.5 py-2 text-center text-[13px] text-muted-foreground">{tr('noActivity')}</li>}
          {s.log.slice(0, 5).map((e) => (
            <li key={`${e.t}-${e.tool}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
              <i className={cn('size-1.5 shrink-0 rounded-full', e.ok ? 'bg-success' : 'bg-destructive')} />
              <span className="min-w-0 flex-1 truncate" title={e.summary}>
                {e.summary}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{timeAgo(e.t, prefs.lang)}</span>
            </li>
          ))}
        </ul>
        </>
      )}

      <footer className="flex items-center gap-2 pt-0.5">
        <ToggleGroup type="single" value={prefs.lang} onValueChange={(v) => v && void update({ lang: v as Prefs['lang'] })} aria-label="Language">
          <ToggleGroupItem value="en">EN</ToggleGroupItem>
          <ToggleGroupItem value="vi">VI</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={prefs.theme} onValueChange={(v) => v && void update({ theme: v as Prefs['theme'] })} aria-label="Theme">
          <ToggleGroupItem value="light" aria-label="Light">{Icon.sun}</ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark">{Icon.moon}</ToggleGroupItem>
          <ToggleGroupItem value="system" aria-label="System">{Icon.monitor}</ToggleGroupItem>
        </ToggleGroup>
        {signedIn && (
          <Button id="logout" variant="link" size="sm" className="ml-auto" onClick={() => void send({ type: 'logout' })}>
            {tr('disconnect')}
          </Button>
        )}
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
