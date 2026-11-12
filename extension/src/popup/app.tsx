import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t, type Key } from '../i18n';
import type { AccessMode, PopupState } from '../messages';
import { PendingPrompts, SitesSection } from './sites-section';
import { SecretsSection } from './secrets-section';
import { Badge, Button, Card, Collapsible, Input, ToggleGroup, ToggleGroupItem } from './ui/components';
import { localSnippet } from '../../../shared/local-config';
import { Icon } from './ui/icons';
import { PrefsMenu } from './ui/prefs-menu';
import { post, send } from './send';
import { usePrefs } from './use-prefs';
import { cn } from './ui/utils';

const ACCESS_MODES: AccessMode[] = ['full', 'ask', 'read'];

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

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

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

function App() {
  const prefs = usePrefs();
  const [s, setState] = useState<PopupState | null>(null);
  const [password, setPassword] = useState('');
  // Shown from the moment of the click until the background reports the outcome.
  const [pending, setPending] = useState<'connect' | 'logout' | null>(null);

  const refresh = useCallback(async () => setState(await send<PopupState>({ type: 'get-state' })), []);

  useEffect(() => {
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
    if (!s) return;
    if (pending === 'connect' && (s.code || s.lastError || s.needsPassword)) setPending(null);
    if (pending === 'logout' && !s.code) setPending(null);
  }, [s, pending]);

  if (!prefs || !s) return null;
  const tr = (k: Key) => t(prefs.lang, k);

  const signedIn = !!s.code;
  const active = signedIn || s.local.enabled;
  const localUp = s.local.status === 'connected';
  // The header shows the cloud connection, or the local one when that is all the user uses.
  const headerStatus = s.status === 'connected' || localUp ? 'connected' : signedIn || !s.local.enabled ? s.status : s.local.status;
  const statusKey = active && s.paused ? 'paused' : headerStatus;
  const statusText = active && s.paused ? tr('paused') : tr(`status_${headerStatus}` as Key);
  const localText = s.local.status === 'connecting' ? tr('localWaiting') : tr(`status_${s.local.status}` as Key);
  const snippet = localSnippet(s.gateway, s.local.port);
  const error = s.lastError ? tr(`err_${s.lastError}` as Key) : '';
  const mcpUrl = `${s.gateway}/mcp`;
  const busy = pending === 'connect' || (s.status === 'connecting' && !s.code);
  const connect = () => {
    setPending('connect');
    post({ type: 'connect', password });
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <div className="grid size-6.5 place-items-center rounded-md bg-primary text-primary-foreground [&_svg]:size-4">{Icon.logo}</div>
        <b className="flex-1 text-[15px] font-semibold">Helmsman</b>
        <Badge id="status">
          <i className={cn('size-1.5 rounded-full', DOT[statusKey])} />
          <span id="status-text">{statusText}</span>
        </Badge>
        <PrefsMenu prefs={prefs} />
      </header>

      <PendingPrompts s={s} lang={prefs.lang} />

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
                onKeyDown={(e) => e.key === 'Enter' && connect()}
              />
            </label>
          )}
          <Button id="login" className="w-full" disabled={busy} aria-busy={busy} onClick={connect}>
            {busy && <Spinner />}
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
            <Button id="use-here" className="w-full" onClick={() => post({ type: 'reconnect' })}>
              {tr('useHere')}
            </Button>
          )}
          {/* Same slot as Connect when signed out. */}
          <Button
            id="logout"
            variant="outline"
            className="w-full"
            disabled={pending === 'logout'}
            aria-busy={pending === 'logout'}
            onClick={() => {
              setPending('logout');
              post({ type: 'logout' });
            }}
          >
            {pending === 'logout' && <Spinner />}
            {pending === 'logout' ? tr('disconnecting') : tr('disconnect')}
          </Button>
        </section>
      )}

      <Collapsible id="access" title={tr('access')} count={tr(`access_${s.accessMode}`)}>
        <ToggleGroup
          type="single"
          value={s.accessMode}
          onValueChange={(v) => v && post({ type: 'set-access-mode', mode: v as AccessMode })}
          aria-label={tr('access')}
          className="grid grid-cols-3"
        >
          {ACCESS_MODES.map((m) => (
            <ToggleGroupItem key={m} value={m} data-mode={m} className={cn('h-8 text-[13px]', m === 'full' && 'data-[state=on]:text-destructive')}>
              {tr(`access_${m}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p id="access-hint" className="text-[13px] text-muted-foreground">{tr(`access_${s.accessMode}_hint`)}</p>
      </Collapsible>

      <Collapsible id="local" title={tr('localMode')}>
        <span id="local-status" data-status={s.local.status} className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <i className={cn('size-1.5 rounded-full', DOT[s.local.status])} />
          {localText}
        </span>
        <div className="text-[13px] text-muted-foreground">{tr('localHint')}</div>
        <div className="flex items-center justify-between gap-2">
          <code id="local-config" className="min-w-0 truncate font-mono text-[13px]" title={snippet}>
            {snippet}
          </code>
          <CopyButton value={snippet} label={tr('copy')} />
        </div>
      </Collapsible>

      <SitesSection s={s} lang={prefs.lang} />
      <SecretsSection lang={prefs.lang} />

      <footer className="flex justify-end">
        <Button id="open-audit" variant="link" size="sm" onClick={() => post({ type: 'open-audit' })}>
          {tr('audit')}
        </Button>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
