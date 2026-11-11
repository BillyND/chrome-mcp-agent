# Chrome Web Store listing kit

Everything to paste into the Chrome Web Store developer dashboard for **Helmsman – AI browser agent**. Validate the package first with `npm run check:store`.

Privacy policy URL: `https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/privacy` (served by the gateway, EN + VI, linked from the landing footer).

## Name, summary

| Field | Value |
|---|---|
| Name | `Helmsman – AI browser agent` (from `manifest.json`) |
| Summary (max 132 chars, same as manifest `description`) | `Let ChatGPT, Claude and other AI agents drive your browser: read pages, click, type and fill forms, even in iframes and canvases.` |
| Category | Productivity (alt: Developer Tools) |
| Language | English (listing translated to Vietnamese below) |
| Homepage | `https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/` |
| Support | `https://github.com/BillyND/chrome-mcp-agent/issues` |

## Description (English)

> Helmsman lets the AI assistant you already use drive your real Chrome: ChatGPT (including the free plan), Claude Desktop, Claude Code, Cursor, VS Code, Codex CLI and any other MCP client.
>
> What your AI can do, as you would:
> • Read pages as a structured outline, including content inside iframes (even cross-origin) and shadow DOM
> • Click, type (Vietnamese and other IMEs included), press shortcuts, scroll, drag and drop
> • Fill whole forms, choose options, upload files, save pages as PDF, take screenshots
> • Work on canvas apps such as Google Sheets by clicking at coordinates
> • Run several agents side by side, each in its own tab group
>
> You stay in control:
> • "Allow AI control" is a one-click kill switch, and an on-page bar shows when the agent works, with a Stop button
> • Per-site rules: allow, ask or block any website. Banks, crypto exchanges, adult sites and the Chrome Web Store are blocked by default
> • Sensitive actions (submit, pay, delete, post, download, password fields) always ask you on the page first
> • Card numbers, ID numbers and secret-looking files are hard-blocked; a secrets vault keeps passwords out of the model's sight
> • Text taken from web pages is labelled as untrusted data to resist prompt injection
> • A local audit log records every tool call; it never leaves your computer
>
> Two ways to connect, no account needed: Cloud mode (ChatGPT connector with a one-time connection code) or Local mode (an MCP server on 127.0.0.1 for desktop clients). Page content goes only to the AI client you connect. Nothing is sold or shared.
>
> Requires an AI client that supports MCP. Open source: https://github.com/BillyND/chrome-mcp-agent

## Mô tả (Tiếng Việt)

Tóm tắt: `Cho ChatGPT, Claude và các AI khác điều khiển trình duyệt của bạn: đọc trang, bấm, gõ, điền form, cả trong iframe và canvas.`

> Helmsman cho trợ lý AI bạn đang dùng điều khiển Chrome thật của bạn: ChatGPT (kể cả gói Free), Claude Desktop, Claude Code, Cursor, VS Code, Codex CLI và mọi client MCP khác.
>
> AI làm được như bạn:
> • Đọc trang dưới dạng cây có cấu trúc, gồm cả nội dung trong iframe (kể cả khác domain) và shadow DOM
> • Bấm, gõ (gồm tiếng Việt), phím tắt, cuộn, kéo thả
> • Điền cả form, chọn tuỳ chọn, tải file lên, lưu trang PDF, chụp màn hình
> • Làm việc với app canvas như Google Sheets bằng cách bấm theo toạ độ
> • Chạy nhiều agent song song, mỗi agent một nhóm tab riêng
>
> Bạn luôn nắm quyền:
> • Công tắc "Cho phép AI điều khiển" dừng AI ngay; thanh trên trang cho biết agent đang làm và có nút Dừng
> • Quy tắc theo trang: cho phép, hỏi hoặc chặn từng website. Ngân hàng, sàn crypto, web người lớn và Chrome Web Store bị chặn mặc định
> • Hành động nhạy cảm (gửi, thanh toán, xoá, đăng bài, tải file, ô mật khẩu) luôn hỏi bạn ngay trên trang
> • Số thẻ, số giấy tờ và file giống khoá bí mật bị chặn cứng; kho bí mật giữ mật khẩu ngoài tầm nhìn của model
> • Chữ lấy từ trang web được gắn nhãn dữ liệu không đáng tin để chống prompt injection
> • Nhật ký kiểm tra cục bộ ghi mọi lệnh gọi tool và không bao giờ rời khỏi máy bạn
>
> Hai cách kết nối, không cần tài khoản: chế độ đám mây (connector ChatGPT với mã kết nối dùng một lần) hoặc chế độ cục bộ (server MCP trên 127.0.0.1 cho client trên máy). Nội dung trang chỉ đi tới client AI bạn kết nối. Không bán hay chia sẻ dữ liệu.
>
> Cần client AI hỗ trợ MCP. Mã nguồn mở: https://github.com/BillyND/chrome-mcp-agent

## Single purpose

Helmsman has one purpose: let the user's own AI assistant operate the user's browser tabs on their behalf (read pages, click, type, fill forms, take screenshots), under rules and confirmations the user controls.

Every permission below serves that purpose, and nothing runs until the user connects an AI client.

## Permission justifications

Paste each into the matching field of the "Privacy practices" tab.

| Permission | Justification |
|---|---|
| `debugger` | Core function. Mouse clicks, key presses, text input, drag and drop, screenshots, PDF export and JavaScript dialog handling are sent through the Chrome DevTools Protocol so pages receive real, trusted input events (synthetic `dispatchEvent` calls are ignored by canvas apps, IME text fields and many frameworks). It attaches only to tabs the AI agent is told to work on, detaches after 3 minutes without use, and Chrome shows its own "is debugging this browser" bar while attached. |
| `tabs` | List open tabs (title, URL) so the agent can pick the right one, and open, select and close tabs it needs. Also used to check a tab's URL against the user's site rules before any tool touches it. |
| `tabGroups` | Each AI agent gets its own named Chrome tab group so the user can see which tabs an agent is using and several agents can work side by side. |
| `scripting` | Inject the extension's own bundled content script into pages and frames to read the accessibility tree, resolve element positions and draw the on-page agent bar and confirmation prompts. No remotely hosted code is injected. |
| `storage` | `chrome.storage.local` keeps everything that must stay on the device: secrets vault, audit log, site rules, saved workflows, interface preferences and the connection state. |
| `alarms` | Keeps the service worker's connection to the gateway alive, retries after disconnects and cleans up idle debugger sessions. |
| `downloads` | Implements the "download a file" and "save page as PDF" tools to the user's Downloads folder. Downloads always ask the user first. |
| `webNavigation` | Detects page loads, redirects and frame creation so the agent waits for pages to finish loading, can address iframes, and so site rules are re-checked after a redirect. |
| `cookies` | Used only by the `browser_cookies` tool when the AI asks, and by the site-rule check for the cookie's target host. Results go only to the user's own AI client. Reading or writing is blocked for hosts the user's rules block. |
| `history` | Used only by the `browser_history` tool (search or list recent visits) when the AI asks, so it can reopen a page the user mentions. Results go only to the user's own AI client. |
| Host permission `<all_urls>` | The user may ask the AI to work on any website, so the content script and debugger must be able to run on any origin and in every frame (cross-origin iframes included). Access is narrowed by the user: per-site Allow / Ask / Block rules (banks, crypto, adult sites and the Chrome Web Store are blocked by default) and an on/off master switch. |

## Remote code

**No, this extension does not use remote code.** All JavaScript is bundled in the package (`background.js`, `content.js`, `popup.js`, `audit.js`). There are no remote `<script>` tags, no `eval` or `new Function` of fetched strings, and no loading of external modules. The `browser_evaluate` tool runs a script the user's own AI client supplies, inside the page the user asked it to work on, and it is gated by the user's site rules and confirmation prompts; the extension never downloads code from its own servers.

## Data usage disclosures (Privacy practices tab)

What the extension handles, answered as the dashboard asks. All of it is processed only at the request of the user's own AI client, sent only to that client and never to the publisher.

| Data type | Collect? | Why |
|---|---|---|
| Personally identifiable information | Yes (incidental) | Appears on pages the AI is asked to read or fill, for example a name in a form. Sent only to the user's AI client. |
| Health information | Yes (incidental) | Only if the user points the AI at a page that shows it. Same handling. |
| Financial and payment information | Yes (incidental) | Pages may show it. Card numbers, CVV and ID numbers cannot be typed by the AI (hard block). Same handling. |
| Authentication information | Yes | The `browser_cookies` tool and the secrets vault. Vault values stay in `chrome.storage.local`, are substituted at typing time and are masked from every tool result. |
| Personal communications | Yes (incidental) | Webmail and chat pages the user asks the AI to read. |
| Location | No | |
| Web history | Yes | `browser_history` tool and the URLs and titles of tabs. |
| User activity | Yes | Clicks and keystrokes the AI performs, recorded in the local audit log (never sent anywhere). |
| Website content | Yes | The core function: text, structure, images and screenshots of pages. |

Certifications to tick (all true):

- I do not sell or transfer user data to third parties, outside of the approved use cases (the only recipient is the AI client the user chose).
- I do not use or transfer user data for purposes that are unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Data handling statements for the privacy policy: the gateway relays and does not store page content; its KV stores only OAuth grants, random device ids, connection codes and a 10-minute failed-code counter. Secrets, audit log, site rules and workflows stay in `chrome.storage.local`. See `/privacy`.

## Instructions for the reviewer (Test instructions tab)

No account or password is needed. Two ways to test; Local mode needs no external service.

**A. Connection code flow (cloud mode)**

1. Install the extension and pin it. Click the icon, then **Connect**. The popup shows a connection code such as `K7QX2-MN4PD` and a green **Connected** dot.
2. Copy the MCP URL from the popup (`https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/mcp`). Any MCP client that supports remote OAuth servers can use it, for example ChatGPT (Settings, Apps & Connectors, Advanced, Developer mode, Create) or the MCP Inspector (`npx @modelcontextprotocol/inspector`, transport Streamable HTTP, OAuth).
3. On the consent page that opens, paste the connection code and press **Allow**. The client now lists about 35 `browser_*` tools.
4. Call `browser_tabs` with `{"action":"list"}`, then `browser_navigate` to `https://example.com`, then `browser_snapshot`. A cursor and an "Agent is working" bar with a **Stop** button appear on the page.
5. Try a sensitive action, for example `browser_click` on a button labelled "Submit": a confirmation prompt appears on the page and nothing happens until the reviewer approves it.
6. Click **Disconnect** in the popup: the code is deleted and the client immediately loses access.

**B. Local mode (no cloud, no OAuth)**

1. Click the icon and turn on the **Local mode** switch. The dot reads "Waiting for local server".
2. In a terminal run the stdio MCP server (Node 20+): `npx -y --package=https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/helmsman-mcp.tgz helmsman-mcp`, or point any MCP client at that command (Claude Desktop, Cursor, Claude Code).
3. The dot turns **Connected**. Call the same tools as above.

**Other things to check**

- The **Allow AI control** switch pauses the agent at once.
- Popup, **Sites**: default blocks are listed (banks, crypto, adult, Chrome Web Store); set a site to Ask or Block and call a tool on it.
- Popup, **Audit log**: every call is listed, stored locally only.
- The extension shows Chrome's own yellow "debugging this browser" bar while a tab is attached; this is expected.

## Graphic assets

Upload in the dashboard under "Store listing". Pixel sizes are exact.

| Asset | Size | Required | File |
|---|---|---|---|
| Store icon | 128 x 128 PNG | Yes | `extension/unpacked/icons/128.png` (generated by `scripts/icons.mjs`, also in the zip) |
| Screenshots | 1280 x 800 (or 640 x 400), JPEG or 24-bit PNG without alpha, 1 to 5 | Yes (at least 1) | `docs/store/screenshots/*.png` |
| Small promo tile | 440 x 280 | Yes | `docs/store/screenshots/promo-small-440x280.png` |
| Marquee promo tile | 1400 x 560 | Optional | `docs/store/screenshots/promo-marquee-1400x560.png` |
| Promo video | YouTube URL | Optional | none |

Screenshots (regenerate with `npm run store:shots` while `wrangler dev` runs on `E2E_PORT`):

1. `1-popup.png`: popup connected, with connection code and the Allow AI control switch
2. `2-confirmation-prompt.png`: on-page confirmation before a sensitive action
3. `3-agent-cursor.png`: agent bar with Stop button and the on-page cursor
4. `4-site-rules.png`: per-site Allow / Ask / Block rules in the popup
5. `5-landing.png`: the gateway landing page

## Publishing checklist

1. `npm run pack:ext` (production build, points at the deployed gateway) and `npm run check:store`.
2. Upload `extension/chrome-mcp-agent.zip`.
3. Fill the listing from this file; set the privacy policy URL to `/privacy` on the gateway; choose visibility (Unlisted first is fine).
4. Dashboard fee is 5 USD, paid once.
