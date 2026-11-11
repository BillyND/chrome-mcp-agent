// The audit log page: every tool call the agents made, newest first, with export and clear.
// Reads the same activity log the popup shows (chrome.storage.local "log").

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t, type Key } from '../i18n';
import type { ActivityEntry, RuntimeMessage } from '../messages';
import { Badge, Button } from '../popup/ui/components';
import { cn } from '../popup/ui/utils';
import { usePrefs } from '../popup/use-prefs';

const outcomeOf = (e: ActivityEntry) => e.outcome ?? (e.ok ? 'ok' : 'error');

const TONE: Record<string, string> = {
  ok: 'text-success',
  error: 'text-destructive',
  blocked: 'text-destructive',
  declined: 'text-warning',
};

function download(entries: ActivityEntry[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `helmsman-audit-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function App() {
  const prefs = usePrefs();
  const [log, setLog] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const load = () => void chrome.storage.local.get('log').then(({ log: l }) => setLog((l as ActivityEntry[] | undefined) ?? []));
    load();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => changes.log && load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (!prefs) return null;
  const tr = (k: Key) => t(prefs.lang, k);
  const clear = () => {
    if (confirm(`${tr('audit_clear')}?`)) void chrome.runtime.sendMessage({ type: 'clear-log' } satisfies RuntimeMessage);
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{tr('audit_title')}</h1>
          <p className="text-sm text-muted-foreground">{tr('audit_sub')}</p>
        </div>
        <Badge id="count">{log.length}</Badge>
        <Button id="export" variant="outline" size="sm" disabled={!log.length} onClick={() => download(log)}>
          {tr('audit_export')}
        </Button>
        <Button id="clear" variant="destructive" size="sm" disabled={!log.length} onClick={clear}>
          {tr('audit_clear')}
        </Button>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table id="audit-table" className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {(['audit_time', 'audit_agent', 'audit_tool', 'audit_site', 'audit_result', 'audit_approval'] as Key[]).map((k) => (
                <th key={k} className="px-3 py-2 font-medium">{tr(k)}</th>
              ))}
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {log.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{tr('audit_empty')}</td>
              </tr>
            )}
            {log.map((e, i) => {
              const outcome = outcomeOf(e);
              return (
                <tr key={`${e.t}-${i}`} className="audit-row align-top" data-tool={e.tool} data-outcome={outcome}>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">{new Date(e.t).toLocaleString(prefs.lang)}</td>
                  <td className="px-3 py-1.5">{e.agent ?? ''}</td>
                  <td className="px-3 py-1.5 font-mono">{e.tool}</td>
                  <td className="px-3 py-1.5 font-mono">{e.host ?? ''}</td>
                  <td className={cn('px-3 py-1.5', TONE[outcome])}>{tr(`outcome_${outcome}` as Key)}</td>
                  <td className="px-3 py-1.5">{e.approval ? tr(`approval_${e.approval}` as Key) : ''}</td>
                  <td className="max-w-80 truncate px-3 py-1.5 text-muted-foreground" title={e.summary}>{e.summary}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
