# Helmsman – AI browser agent

Let ChatGPT, Claude, Cursor or any MCP client drive **your own Chrome**: your real tabs and the accounts you're already signed in to. It reads pages, clicks, types and fills forms, including inside cross-origin iframes, closed shadow DOM and canvas apps such as Google Sheets.

- **Cloud (free):** one MCP URL for ChatGPT, served from Cloudflare Workers.
- **Local:** an MCP server on your machine for Claude Desktop, Cursor, Claude Code, VS Code and Codex CLI. No account needed.
- **Parallel:** several AI agents at once, each in its own Chrome tab group.
- **Safe by default:** site rules, on-page confirmation before sensitive actions, hard blocks, an audit log.

Tiếng Việt: [hướng dẫn 10 phút](docs/san-sang.md) · [tài liệu đầy đủ](docs/huong-dan.md)

---

## Quick start

### ChatGPT (cloud)

1. Download the extension from **https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/**, unzip it, and load it in Chrome:
   1. Open `chrome://extensions`.
   2. Turn on **Developer mode**.
   3. Click **Load unpacked** and pick the unzipped folder.
2. Click the Helmsman icon, then **Connect**. Copy the connection code it shows (e.g. `K7QX2-MN4PD`).
3. In ChatGPT, open **Settings → Apps & Connectors → Advanced**, turn on **Developer mode** and click **Create**:
   - **URL:** `https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/mcp`
   - **Authentication:** OAuth
   - When the consent page asks, paste your connection code.
4. Ask ChatGPT, for example: *"Open my Gmail tab and summarize the 5 newest emails."*

Add `?profile=core` to the URL for a slim set of 13 tools, which uses fewer tokens.

### Claude Desktop, Cursor, Claude Code, VS Code, Codex CLI (local)

Turn on **Local mode** in the popup, then add this server to your client. It needs Node 20+ and nothing to install:

```json
{
  "mcpServers": {
    "helmsman": {
      "command": "npx",
      "args": ["-y", "--package=https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/helmsman-mcp.tgz", "helmsman-mcp"]
    }
  }
}
```

Claude Code: `claude mcp add helmsman -- npx -y --package=https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/helmsman-mcp.tgz helmsman-mcp`

Cloud and local can be used at the same time.

---

## What it can do

| Area | Tools |
|---|---|
| Tabs and navigation | `browser_tabs`, `browser_navigate`, `browser_windows` |
| Reading | `browser_snapshot` (accessibility tree with stable refs across all frames; full, diff, scoped or interactive-only), `browser_read_more`, `browser_get_text`, `browser_find`, `browser_extract` (links, tables, forms, headings) |
| Acting | `browser_click`, `browser_hover`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_press_key`, `browser_scroll`, `browser_drag`, `browser_mouse_xy` (canvas apps), `browser_select_text`, `browser_clipboard` |
| Files and media | `browser_file_upload`, `browser_download`, `browser_screenshot` (CSS-pixel coordinates), `browser_pdf` |
| Page state | `browser_wait_for` (text, selector, network idle), `browser_handle_dialog`, `browser_evaluate`, `browser_emulate` (device, color scheme, network), `browser_cookies`, `browser_history`, `browser_console_messages`, `browser_network_requests` |
| Human in the loop | `browser_request_user` (hand over for login or CAPTCHA) |
| Power features | `browser_secrets_list` (vault: the model types `{{secret:NAME}}` and never sees the value), `browser_workflow` (record and replay, also exposed as MCP prompts) |

How it works:
- **Real input.** Clicks and typing go through the Chrome DevTools Protocol, so pages see trusted events. When Chrome misroutes input into nested cross-site frames, it falls back to DOM events inside that frame.
- **Visible cursor.** An animated cursor glides to every target, and a Stop button stays on the page.
- **Parallel and isolated.** Calls on different tabs run in parallel; calls on the same tab run in order. Each agent gets its own tab group.

## Safety

Everything is enforced in the extension, so it applies to every MCP client.

- **Site rules:** allow, ask or block per site. No site is blocked by default; block any site yourself.
- **On-page confirmation** before sending, deleting, paying, downloading or entering passwords. Page scripts run without asking unless you turn that off under Sites. Only a real click can approve; the agent cannot press the button itself.
- **Hard blocks:** card numbers, ID numbers, account creation and credential files.
- **Prompt-injection hardening:** page content is wrapped as untrusted and hidden text is stripped.
- **Secrets stay hidden:** values are redacted from every result, and screenshots and PDFs are masked.
- **Audit log** of every call, kept locally and exportable.
- **Stop:** flip the popup switch or press Stop on the page to pause all agents instantly.

## Architecture

```
ChatGPT ──MCP + OAuth──► Cloudflare Worker ──► Durable Object (per Chrome) ──WebSocket──► extension
Claude / Cursor ──stdio MCP──► local server (127.0.0.1) ──────────────────────WebSocket──► extension
```

| Path | What it is |
|---|---|
| `worker/` | Cloudflare Worker: MCP endpoint, OAuth 2.1, connection-code pairing, per-device Durable Object relay (hibernating WebSockets), landing and privacy pages |
| `local/` | Local stdio MCP server and loopback WebSocket bridge, shipped as one bundled file |
| `extension/` | Chrome MV3 extension: tool executors (`src/background/tools/`), safety layer (`policy/`, `secrets/`), content scripts, React + shadcn popup |
| `shared/` | Code shared by cloud and local: tool catalog, MCP server factory, relay core, wire protocol |
| `tests/` | Unit (Vitest) and end-to-end (Playwright with a real Chromium and the extension) |
| `docs/` | Vietnamese user guide, readiness guide, Chrome Web Store kit |

## Development

```bash
npm install
npm run typecheck                       # worker, extension, local
npm test                                # unit tests
npm run test:e2e                        # real Chromium + extension + wrangler dev
REAL_SITES=1 npx playwright test tests/real-sites.e2e.ts   # live public websites
npm run dev                             # gateway at http://localhost:8787 (needs worker/.dev.vars)
node scripts/pack-extension.mjs --dev   # extension pointing at localhost
```

Deploy your own gateway:

```bash
npx wrangler login
npm run setup                           # KV, deploy, secrets, packs the extension
ACCESS_PASSWORD=... npm run setup       # optional group password
npm run check:live                      # end-to-end check against the deployed gateway
npm run check:store                     # validate the Chrome Web Store package
```

## Test status

| Suite | Result |
|---|---|
| Unit (Vitest) | 146 passed |
| End-to-end (Playwright) | 110 passed: cloud, local mode, multi-agent, token efficiency, safety |
| Real websites | 14/14: Wikipedia, Google Sheets, MDN, React docs, Shoelace, Excalidraw, httpbin, the-internet |
| Live gateway check | passed |

Details: [real-site results](plans/reports/real-sites-261112-0335-results.md) · [competitor gap analysis](plans/reports/researcher-261112-0058-browser-agent-gap-analysis.md)

## Limitations

- Chrome does not let extensions control `chrome://` pages or the Chrome Web Store, and no extension can reach OS dialogs such as Save As or the native file picker.
- While the agent drives a tab, Chrome shows a yellow "is debugging this browser" bar.
- Installs made with **Load unpacked** do not auto-update. The Chrome Web Store listing (kit in `docs/store/`) provides auto-update once published.
