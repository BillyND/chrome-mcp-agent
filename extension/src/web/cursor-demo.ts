// The gateway's /demo page: drives the extension's real overlay (the same cursor, agent bar and
// confirmation card an AI gets in Chrome) through a short scripted task on a sample form.

import { runOverlay } from '../content/overlay';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stopped = () => document.querySelector('helmsman-overlay')?.getAttribute('data-state') === 'hidden';

/** Centre of an element in viewport coordinates, where the overlay draws. */
function centre(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

async function clickOn(el: HTMLElement) {
  const { x, y } = centre(el);
  await runOverlay({ type: 'move', x, y, durationMs: 650 });
  await runOverlay({ type: 'click', x, y });
  await sleep(250);
}

async function typeInto(input: HTMLInputElement, value: string) {
  await clickOn(input);
  input.focus();
  input.value = '';
  for (const ch of value) {
    if (stopped()) return;
    input.value += ch;
    await sleep(55);
  }
}

let running = false;

async function run() {
  if (running) return;
  running = true;
  const button = $<HTMLButtonElement>('demo-run');
  button.disabled = true;
  const name = $<HTMLInputElement>('demo-name');
  const email = $<HTMLInputElement>('demo-email');
  const send = $<HTMLButtonElement>('demo-send');
  const result = $('demo-result');
  name.value = '';
  email.value = '';
  result.textContent = '';
  try {
    await runOverlay({ type: 'show', label: '', paused: false });
    await sleep(600);
    const steps: Array<() => Promise<void>> = [
      () => typeInto(name, 'Nguyễn Văn A'),
      () => typeInto(email, 'a@example.com'),
      () => clickOn(send),
      async () => {
        // A sensitive action waits for the person, exactly like in Chrome.
        await runOverlay({
          type: 'prompt',
          prompt: { id: 'demo', kind: 'sensitive', agent: 'claude-code', host: location.host, label: send.querySelector(`[data-l="${document.documentElement.lang}"]`)?.textContent ?? '', category: 'send', choices: ['approve', 'decline'] },
        });
        for (let i = 0; i < 50 && document.querySelector('helmsman-overlay') && !stopped(); i++) await sleep(100);
        await runOverlay({ type: 'prompt-end', id: 'demo' });
        result.textContent = '✓';
      },
      // Resting between steps: the cursor sways while the AI thinks.
      () => sleep(4000),
      () => clickOn($('demo-title')),
      () => sleep(3000),
    ];
    for (const step of steps) {
      if (stopped()) break;
      await step();
    }
    // The agent calls browser_done: everything goes away at once.
    await runOverlay({ type: 'hide' });
  } finally {
    running = false;
    button.disabled = false;
  }
}

$('demo-run')?.addEventListener('click', () => void run());
