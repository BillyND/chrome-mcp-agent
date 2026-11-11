// Driving the extension's on-page confirmation prompts like a person would: find the prompt card
// (it lives in a closed shadow root, so the extension's own isolated world reads its layout) and
// click its buttons with real mouse input through Playwright.

import type { BrowserContext, Page, Worker } from '@playwright/test';

export interface PromptButton {
  label: string;
  primary: boolean;
  x: number;
  y: number;
}

export interface PromptView {
  page: Page;
  kind: string;
  title: string;
  detail: string;
  buttons: PromptButton[];
}

const targetIds = new WeakMap<Page, string>();

async function targetIdOf(ctx: BrowserContext, page: Page): Promise<string> {
  let id = targetIds.get(page);
  if (!id) {
    const session = await ctx.newCDPSession(page);
    id = (await session.send('Target.getTargetInfo')).targetInfo.targetId;
    await session.detach().catch(() => {});
    targetIds.set(page, id);
  }
  return id;
}

/** Every prompt currently drawn on any open tab. */
export async function readPrompts(ctx: BrowserContext, sw: Worker): Promise<PromptView[]> {
  const targets = await sw.evaluate(async () => {
    const all = await chrome.debugger.getTargets();
    return all.filter((t) => t.tabId !== undefined).map((t) => ({ id: t.id, tabId: t.tabId as number }));
  });
  const found: PromptView[] = [];
  for (const page of ctx.pages()) {
    if (page.isClosed() || !/^(https?:|about:blank)/.test(page.url())) continue;
    const id = await targetIdOf(ctx, page).catch(() => '');
    const tab = targets.find((t) => t.id === id)?.tabId;
    if (tab === undefined) continue;
    const view = await sw.evaluate(async (tabId) => {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'ISOLATED',
          func: () => {
            const host = document.querySelector('helmsman-overlay');
            const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
            const card = root?.querySelector('.prompt');
            if (!card) return null;
            return {
              kind: card.className.replace('prompt', '').trim(),
              title: card.querySelector('h4')?.textContent ?? '',
              detail: card.querySelector('p')?.textContent ?? '',
              buttons: [...card.querySelectorAll('button')].map((b: HTMLElement) => {
                const r = b.getBoundingClientRect();
                return { label: b.textContent ?? '', primary: b.classList.contains('primary'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
              }),
            };
          },
        });
        return r?.result ?? null;
      } catch {
        return null;
      }
    }, tab);
    if (view) found.push({ page, ...view });
  }
  return found;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until a prompt is on screen and returns it. */
export async function waitForPrompt(ctx: BrowserContext, sw: Worker, timeoutMs = 15_000): Promise<PromptView> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [prompt] = await readPrompts(ctx, sw);
    if (prompt) return prompt;
    await sleep(120);
  }
  throw new Error('No prompt appeared');
}

/** Real mouse click on the prompt button whose label matches. */
export async function clickPromptButton(prompt: PromptView, label: RegExp | string): Promise<void> {
  const button = prompt.buttons.find((b) => (typeof label === 'string' ? b.label === label : label.test(b.label)));
  if (!button) throw new Error(`No button ${label} in ${JSON.stringify(prompt.buttons.map((b) => b.label))}`);
  await prompt.page.bringToFront();
  await prompt.page.mouse.click(button.x, button.y);
}

/** Waits for a prompt and clicks `label` on it. */
export async function answerPrompt(ctx: BrowserContext, sw: Worker, label: RegExp | string): Promise<PromptView> {
  const prompt = await waitForPrompt(ctx, sw);
  await clickPromptButton(prompt, label);
  return prompt;
}

/** Stands in for a user who approves everything: clicks the primary button of every prompt that appears. Returns a stop function. */
export function autoApprove(ctx: BrowserContext, sw: Worker): () => void {
  let stopped = false;
  void (async () => {
    while (!stopped) {
      try {
        for (const prompt of await readPrompts(ctx, sw)) {
          const primary = prompt.buttons.find((b) => b.primary);
          if (primary) {
            await prompt.page.bringToFront();
            await prompt.page.mouse.click(primary.x, primary.y);
          }
        }
      } catch {
        /* a page navigating or closing: try again */
      }
      await sleep(250);
    }
  })();
  return () => {
    stopped = true;
  };
}
