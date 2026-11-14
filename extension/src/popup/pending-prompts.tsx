// Popup fallback for handback prompts that cannot be shown in the active page.

import type { Lang } from '../i18n';
import type { PopupState } from '../messages';
import { choiceLabel, isPrimary, promptCopy } from '../prompt-copy';
import { post } from './send';
import { Button, Card } from './ui/components';

export function PendingPrompts({ s, lang }: { s: PopupState; lang: Lang }) {
  if (!s.pending.length) return null;
  return (
    <section id="pending" className="flex flex-col gap-2">
      {s.pending.map((p) => {
        const { title, detail } = promptCopy(lang, p);
        const answer = (choice: (typeof p.choices)[number]) => post({ type: 'approval-decision', id: p.id, choice });
        return (
          <Card key={p.id} className="flex flex-col gap-2 border-warning/60">
            <div className="text-[13px] font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{detail}</div>
            <div className="flex flex-wrap justify-end gap-2">
              {p.choices.map((c) => (
                <Button key={c} size="sm" variant={isPrimary(c) ? 'default' : 'outline'} onClick={() => answer(c)}>
                  {choiceLabel(lang, c)}
                </Button>
              ))}
            </div>
          </Card>
        );
      })}
    </section>
  );
}
