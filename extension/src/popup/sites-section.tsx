// Popup parts for the safety layer: confirmations waiting for the user (when the page could not show
// them) and the site rules.

import { useState } from 'react';
import { t, type Key, type Lang } from '../i18n';
import type { PopupState, RuntimeMessage, SiteAction } from '../messages';
import { choiceLabel, isPrimary, promptCopy } from '../prompt-copy';
import { Button, Card, Collapsible, Input } from './ui/components';
import { cn } from './ui/utils';

const send = (msg: RuntimeMessage) => chrome.runtime.sendMessage(msg).catch(() => {});

/** Questions the page prompt could not show (chrome:// pages, closed tabs) are answered here. */
export function PendingPrompts({ s, lang }: { s: PopupState; lang: Lang }) {
  if (!s.pending.length) return null;
  return (
    <section id="pending" className="flex flex-col gap-2">
      {s.pending.map((p) => {
        const { title, detail } = promptCopy(lang, p);
        const answer = (choice: (typeof p.choices)[number]) => void send({ type: 'approval-decision', id: p.id, choice });
        return (
          <Card key={p.id} className="flex flex-col gap-2 border-warning/60">
            <div className="text-[13px] font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{detail}</div>
            <div className="flex flex-wrap justify-end gap-2">
              {p.choices.map((c) => (
                <Button key={c} size="sm" variant={isPrimary(c) ? 'default' : 'outline'} onClick={() => answer(c)}>
                  {choiceLabel(lang, p, c)}
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

/** The user's per-site rules. */
export function SitesSection({ s, lang }: { s: PopupState; lang: Lang }) {
  const tr = (k: Key) => t(lang, k);
  const [host, setHost] = useState('');
  const [action, setAction] = useState<SiteAction>('block');
  const add = () => {
    if (!host.trim()) return;
    void send({ type: 'set-site-rule', host, action });
    setHost('');
  };

  return (
    <Collapsible id="sites" title={tr('sites')} count={s.sites.rules.length}>
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
    </Collapsible>
  );
}
