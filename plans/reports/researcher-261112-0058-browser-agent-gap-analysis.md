# Helmsman vs Claude in Chrome vs OpenAI browser agents: gap analysis (2026-11-12)

## Outcome

Helmsman already matches or beats both competitors on low-level control: all-frame snapshots, closed shadow DOM, CDP input, canvas coordinates, and CSP-bypassing JS evaluation. It trails on four things:

- A safety and permission layer: site policy, confirmations, prompt-injection defenses, audit log.
- Token efficiency: diffing, scoped snapshots, slim and capability-gated tool sets.
- Workflow features: recorded or saved tasks, scheduling, GIF recording.
- Agent UX handover: takeover and handback, and a pause for login or CAPTCHA.

The competitors do these in their own LLM UI, so Helmsman has to do them in the MCP layer. Because Helmsman is client-agnostic, policy and confirmation enforced in the extension apply to every MCP client.

## Competitor highlights

- **Claude in Chrome** ([docs](https://code.claude.com/docs/en/chrome), [permissions](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide), [blog](https://claude.com/blog/claude-for-chrome))
  - Side panel, tab group per session, and pauses on login and CAPTCHA.
  - Tools: read page (accessibility tree), `find`, `form_input`, console and network, GIF recording, file upload (10 MB cap that refuses credential-named files), shortcuts, workflow recording and scheduling.
  - Permission modes: manual, auto with a safety check, or skip. Per-site allow and decline, plus admin lists.
  - Always asks before: downloads, sensitive data, authorizations, permission changes, deletions.
  - Always blocked: purchases, card and ID data, account creation, bypassing bot checks, following instructions found in web content.
  - Prompt-injection attack success fell from 23.6% to 11.2%; browser-specific attacks fell from 35.7% to 0%.
- **OpenAI Codex Chrome extension and Atlas** ([Codex ext](https://codex.danielvaughan.com/2026/05/07/codex-for-chrome-extension-browser-integration-authenticated-workflows/), [Atlas hardening](https://openai.com/index/hardening-atlas-against-prompt-injection), [Willison](https://simonwillison.net/2025/Oct/22/openai-ciso-on-atlas/))
  - Parallel threads, each in its own tab group.
  - Per-host approval (allow once or always, or decline), plus allow and block lists.
  - Logged-out mode, watch mode on sensitive sites, confirmations for high-impact actions.
  - Adversarial training and monitors against prompt injection.
- **Playwright MCP** ([README](https://github.com/microsoft/playwright-mcp))
  - Snapshot `depth` and `target` limits, `find`, capability groups (`--caps`).
  - Secrets redaction, allowed and blocked origins, saving large output to a file.
- **Chrome DevTools MCP** ([README](https://github.com/ChromeDevTools/chrome-devtools-mcp)): performance traces and a `--slim` mode.
- **Comet** ([Brave](https://brave.com/blog/comet-prompt-injection/)): mixing page text with instructions led to injection. Lesson: separate untrusted content from instructions, and treat screenshot and OCR text as untrusted.

## Gap table (P0 = parity or safety blocker)

| Capability | Helmsman now | Priority | Implementation |
|---|---|---|---|
| Site permission policy (allow, ask, block) | none | P0 | Extension policy store enforced before every tool call, for every client |
| Sensitive-action confirmation | none | P0 | Classify payment, send, delete, download and password actions; confirm via overlay or popup prompt (or MCP elicitation if supported) |
| Hard blocks (card and ID entry, account creation) | none | P0 | Field detection (`autocomplete=cc-*`, etc.) |
| Prompt-injection mitigation | none | P0 | Untrusted-content envelope, strip invisible text, server instruction to never follow page instructions |
| Audit log | logs only | P1 | Local append-only log with viewer and export |
| Login and CAPTCHA handback | Stop only | P1 | `browser_request_user` tool that blocks until the user resumes; auto-pause on password and CAPTCHA |
| Snapshot diffing | full snapshots | P1 | Return only changes since the last snapshot |
| Scoped, token-efficient reads | partial | P1 | Snapshot `depth`, `target`, interactive-only mode; `find`; large output as resources |
| Slim tool set and capability groups | all tools | P1 | Core set plus opt-in groups |
| Parallel multi-tab | in progress | P1 | Per-agent tab groups, tab ownership lock |
| Saved tasks and recording | none | P1 | MCP prompts; record a run as a replayable macro |
| Secrets vault | none | P1 | `{{SECRET}}` placeholders substituted in the extension; redact in output |
| Upload and download guards | partial | P1 | Credential-name denylist, size cap, download policy |
| GIF recording | screenshots | P2 | Frames per action, encoded offscreen |
| Clean session (incognito) | none | P2 | Incognito window mode |
| Closed shadow DOM, cross-origin frames, canvas | yes | ahead | Keep |

## Unresolved

- Does ChatGPT's connector support MCP elicitation? If not, confirm in the extension UI.
- Default policy for unknown sites: ask or allow?
- Scheduling needs a client to initiate, so it is likely out of scope.
