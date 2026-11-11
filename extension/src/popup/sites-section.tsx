// Popup parts for the safety layer: confirmations waiting for the user (when the page could not show
// them), the site rules list, and the link to the audit log.

import { useState } from 'react';
import { t, tf, type Key, type Lang } from '../i18n';
import type { Choice, PopupState, RuntimeMessage, SiteAction } from '../messages';
import { Button, Card, Input } from './ui/components';
import { cn } from './ui/utils';

const send = (msg: RuntimeMessage) => chrome.runtime.sendMessage(msg).catch(() => {});

const PRIMARY = new Set<Choice>(['once', 'approve', 'done']);

/** Questions the page prompt could not show (chrome:// pages, closed tabs) are answered here. */
export function PendingPrompts({ s, lang }: { s: PopupState; lang: Lang }) {
  if (!s.pending.length) return null;
  return (
    <section id="pending" className="flex flex-col gap-2">
      {s.pending.map((p) => {
        const params = { agent: p.agent, host: p.host, label: p.label, reason: p.label, category: t(lang, `cat_${p.category}` as Key) };
        return (
          <Card key={p.id} className="flex flex-col gap-2 border-warning/60">
            <div className="text-[13px] font-semibold">{tf(lang, `prompt_${p.kind}` as Key, params)}</div>
            <div className="text-xs text-muted-foreground">{tf(lang, `prompt_${p.kind}_detail` as Key, params)}</div>
            <div className="flex flex-wrap justify-end gap-2">
              {p.choices.map((c) => (
                <Button key={c} size="sm" variant={PRIMARY.has(c) ? 'default' : 'outline'} onClick={() => void send({ type: 'approval-decision', id: p.id, choice: c })}>
                  {t(lang, `choice_${c}` as Key)}
                </Button>
              ))}
            </div>
          </Card>
        );
      })}
    </section>
  );
}

const ACTIONS: SiteAction[] = ['block', 'ask', 'allow'];

/** The user's per-site rules and the built-in blocks, in a collapsible block. */
export function SitesSection({ s, lang }: { s: PopupState; lang: Lang }) {
  const tr = (k: Key) => t(lang, k);
  const [host, setHost] = useState('');
  const [action, setAction] = useState<SiteAction>('block');
  const add = () => {
    if (!host.trim()) return;
    void send({ type: 'set-site-rule', host, action });
    setHost('');
  };
  const count = s.sites.rules.length + s.sites.defaults.length;

  return (
    <div className="flex flex-col gap-2">
      <details id="sites" className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-2 text-[15px] font-medium">
          {tr('sites')}
          <span className="text-[13px] font-normal text-muted-foreground">{count}</span>
        </summary>
        <div className="flex flex-col gap-2 border-t p-2.5">
          <p className="text-xs text-muted-foreground">{tr('sites_hint')}</p>
          <ul id="site-rules" className="divide-y rounded-md border">
            {s.sites.rules.length === 0 && <li className="px-2 py-1.5 text-center text-[13px] text-muted-foreground">{tr('sites_none')}</li>}
            {s.sites.rules.map((r) => (
              <li key={r.host} data-host={r.host} className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-mono" title={r.host}>{r.host}</span>
                <span className={cn('shrink-0 text-xs', r.action === 'block' ? 'text-destructive' : 'text-muted-foreground')}>{tr(`site_${r.action}` as Key)}</span>
                <Button variant="link" size="sm" onClick={() => void send({ type: 'set-site-rule', host: r.host, action: null })}>{tr('site_remove')}</Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            <Input className="h-8 min-w-0 flex-1 text-[13px]" placeholder={tr('site_add')} value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <select
              className="h-8 rounded-md border border-input bg-background px-1.5 text-[13px]"
              value={action}
              onChange={(e) => setAction(e.target.value as SiteAction)}
              aria-label="Rule"
            >
              {ACTIONS.map((a) => <option key={a} value={a}>{tr(`site_${a}` as Key)}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={add}>+</Button>
          </div>
          {s.sites.defaults.length > 0 && (
            <details className="rounded-md border">
              <summary className="cursor-pointer list-none px-2 py-1.5 text-[13px] text-muted-foreground">
                {tr('site_default')} ({s.sites.defaults.length})
              </summary>
              <ul className="max-h-40 divide-y overflow-auto border-t">
                {s.sites.defaults.map((d) => (
                  <li key={d.host} className="flex items-center gap-2 px-2 py-1 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-mono" title={d.host}>{d.host}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{d.category}</span>
                    <Button variant="link" size="sm" onClick={() => void send({ type: 'set-site-rule', host: d.host, action: 'allow' })}>{tr('site_unblock')}</Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </details>
      <Button id="open-audit" variant="link" size="sm" className="self-start" onClick={() => void send({ type: 'open-audit' })}>
        {tr('audit')}
      </Button>
    </div>
  );
}
