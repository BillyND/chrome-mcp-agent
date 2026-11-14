// Server-rendered pages: landing (setup guide), consent, and result messages.
// Each page is readable and the consent form works without JS. /ui.css carries the extension's theme
// (the same shadcn tokens and Tailwind classes as the popup) and /ui.js mounts the popup's language and
// theme popovers into the header and switches the guide's tabs.

import { LANG_CODES, type Lang } from '../../shared/langs';
import { localCommand, localServer, localSnippet } from '../../shared/local-config';
import { segmentedClass, segmentedItemClass } from '../../shared/ui-classes';
import { PAGE_STRINGS } from './page-locales';

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Every language is rendered; CSS shows the one matching <html lang>. That keeps the consent form fully
// usable without JS. Copy is written in Vietnamese and English; other languages look up the English text
// in ./page-locales and fall back to English when a phrase has no translation yet. Values that vary go in
// `params` as {name} placeholders so the lookup key stays fixed.
const bi = (vi: string, en: string, params: Record<string, string> = {}) =>
  LANG_CODES.map((l: Lang) => {
    const text = l === 'vi' ? vi : l === 'en' ? en : (PAGE_STRINGS[l][en] ?? en);
    return `<span data-l="${l}">${text.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m)}</span>`;
  }).join('');

// Known server messages (Vietnamese) and their English counterpart.
const EN: Record<string, string> = {
  'Mã kết nối không đúng. Mở extension Helmsman để xem lại mã của bạn.':
    'Wrong connection code. Open the Helmsman extension to see your code again.',
  'Thử quá nhiều lần': 'Too many attempts',
  'Bạn đã nhập sai mã quá nhiều lần. Đợi 10 phút rồi thử lại.': 'Too many wrong codes. Wait 10 minutes and try again.',
  'Không thể tiếp tục': 'Cannot continue',
  'Không xác minh được ứng dụng này.': 'This app could not be verified.',
  'Có lỗi xảy ra': 'Something went wrong',
};
const known = (vi: string) => (EN[vi] ? bi(escapeHtml(vi), escapeHtml(EN[vi])) : escapeHtml(vi));

// Page layout only; colors and radii come from the shared theme in /ui.css.
const CSS = `
${LANG_CODES.map((l) => `html:not([lang=${l}]) [data-l=${l}]`).join(',')}{display:none}
body{font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:600px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:40px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;min-width:0}
.logo{width:32px;height:32px;border-radius:8px;background:var(--primary);color:var(--primary-foreground);display:grid;place-items:center;flex:none}
#prefs{min-width:64px;min-height:32px;display:flex;justify-content:flex-end}
.btn:focus-visible,.field input:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 8px;font-weight:700}
h2{font-size:18px;line-height:1.3;margin:0 0 8px;letter-spacing:-.01em;font-weight:600}
b{font-weight:600}
.muted{color:var(--muted-foreground)}
.card{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:24px;box-shadow:0 1px 2px oklch(0 0 0/5%)}
.btn{appearance:none;border:1px solid transparent;border-radius:var(--radius);height:40px;padding:0 18px;font:500 14px/1 inherit;font-family:inherit;cursor:pointer;background:var(--primary);color:var(--primary-foreground);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.btn:hover{opacity:.9}
.btn.outline{background:var(--card);color:var(--foreground);border-color:var(--input)}
.btn.outline:hover{background:var(--secondary);opacity:1}
.btn.sm{height:34px;padding:0 12px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.hero{margin-bottom:28px}.hero p{margin:0 0 20px;font-size:16px}
.section-title{font-size:16px;margin:32px 0 12px}
.steps{list-style:none;padding:0;margin:0;counter-reset:s;display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
.steps li{counter-increment:s;position:relative;padding-left:40px;min-width:0}
.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:var(--secondary);display:grid;place-items:center;font-size:12px;font-weight:600}
.tip{margin-top:20px;padding:12px 14px;border-radius:var(--radius);background:var(--muted);font-size:14px}
.tablist{display:flex;flex-wrap:wrap;width:100%;margin-bottom:16px}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--muted);border-radius:6px;padding:2px 6px;overflow-wrap:anywhere}
.url{display:flex;gap:8px;margin-top:10px;align-items:stretch}
.url code{flex:1;min-width:0;overflow:auto;white-space:nowrap;border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;display:flex;align-items:center}
.copy .ok,.copy.done .no{display:none}.copy.done .ok{display:inline}
.notice{border:1px solid var(--warning);color:var(--warning);padding:10px 14px;border-radius:var(--radius);font-size:14px;margin:12px 0}
.field{display:flex;flex-direction:column;gap:6px;margin-top:20px;font-size:14px}
.field input{font:600 20px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;height:48px;padding:0 14px;border-radius:var(--radius);border:1px solid var(--input);background:transparent;color:var(--foreground);width:100%}
#demo-name,#demo-email{font:400 15px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:0;text-transform:none;height:40px}
.error{color:var(--destructive);font-weight:500;margin:12px 0 0;font-size:14px}
.big{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--secondary);margin-bottom:12px;font-size:20px}
.prose h2{margin:28px 0 8px}.prose p,.prose ul{margin:0 0 12px}.prose ul{padding-left:20px;list-style:disc}.prose li{margin:4px 0}
.prose table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px}.prose th,.prose td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--border)}.prose th{white-space:nowrap}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
footer a{color:var(--muted-foreground);text-decoration:underline;text-underline-offset:3px}footer a:hover{color:var(--foreground)}
a.link{color:var(--foreground);text-decoration:underline;text-underline-offset:3px}
@media (max-width:420px){h1{font-size:26px}.card{padding:18px}.row .btn{flex:1}}
`;

const LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3l7 17 2.5-7L21 10.5z"/></svg>`;

// Runs in <head> before paint so the saved language and theme apply without a flash (the keys are the
// ones /ui.js reads and writes), and handles the copy buttons.
const SCRIPT = `(function(){var d=document.documentElement,g=function(k){try{return localStorage.getItem(k)}catch(e){return null}};
var l=g('cma-lang'),t=g('cma-theme');var c=${JSON.stringify(LANG_CODES)},b=(navigator.language||'').toLowerCase().split('-')[0];d.lang=c.indexOf(l)>=0?l:c.indexOf(b)>=0?b:'en';
d.classList.toggle('dark',t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));
document.addEventListener('click',function(e){var b=e.target.closest('button[data-copy]');if(!b)return;
var el=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(el.textContent).then(function(){b.classList.add('done');setTimeout(function(){b.classList.remove('done')},1500)})})})();`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="/ui.css"><style>${CSS}</style><script>${SCRIPT}</script><script src="/ui.js" defer></script></head><body><main>
<header><div class="brand"><span class="logo">${LOGO}</span>Helmsman</div><div id="prefs"></div></header>
${body}
</main></body></html>`;
}

let copyIds = 0;
/** A code box with a Copy button. */
const copyBox = (value: string) => {
  const id = `c${++copyIds}`;
  return `<div class="url"><code id="${id}">${escapeHtml(value)}</code><button type="button" class="btn outline sm copy" data-copy="${id}"><span class="no">${bi('Sao chép', 'Copy')}</span><span class="ok">${bi('Đã chép', 'Copied')}</span></button></div>`;
};
const step = (title: string, body: string, extra = '') => `<li><b>${title}</b><div class="muted">${body}</div>${extra}</li>`;
const tip = (vi: string, en: string) => `<p class="tip">${bi(vi, en)}</p>`;

const GET_CODE = step(
  bi('Lấy mã kết nối', 'Get a connection code'),
  bi('Bấm biểu tượng Helmsman trên Chrome, rồi bấm <b>Kết nối</b>. Mã có dạng <code>K7QX2-MN4PD</code>.', 'Click the Helmsman icon in Chrome, then <b>Connect</b>. The code looks like <code>K7QX2-MN4PD</code>.'),
);
const PASTE_CODE = (client: string) =>
  step(
    bi('Dán mã kết nối', 'Paste the connection code'),
    bi('{client} mở trang của Helmsman: dán mã rồi bấm <b>Cho phép</b>.', '{client} opens a Helmsman page: paste the code and click <b>Allow</b>.', { client }),
  );
const LOCAL_CHECK = step(
  bi('Kiểm tra kết nối', 'Check the connection'),
  bi('Mở popup Helmsman → <b>Chế độ cục bộ</b>: trạng thái chuyển sang <b>Đã kết nối</b> khi client chạy. Không cần tài khoản, cần Node 20+.', 'Open the Helmsman popup → <b>Local mode</b>: it shows <b>Connected</b> once the client runs. No account needed; requires Node 20+.'),
);

interface Client {
  id: string;
  name: string;
  steps: string;
}

function clients(publicUrl: string): Client[] {
  const mcpUrl = `${publicUrl}/mcp`;
  const command = localCommand(publicUrl);
  const vscodeConfig = JSON.stringify({ servers: { helmsman: localServer(publicUrl) } });
  const codexConfig = `[mcp_servers.helmsman]\ncommand = "npx"\nargs = ${JSON.stringify(localServer(publicUrl).args)}`;
  return [
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      steps: `<ol class="steps">${GET_CODE}
${step(bi('Bật Developer mode', 'Turn on Developer mode'), bi('ChatGPT → <b>Cài đặt</b> → <b>Apps &amp; Connectors</b> → <b>Advanced settings</b> → bật <b>Developer mode</b>.', 'ChatGPT → <b>Settings</b> → <b>Apps &amp; Connectors</b> → <b>Advanced settings</b> → turn on <b>Developer mode</b>.'))}
${step(bi('Tạo connector', 'Create the connector'), bi('Quay lại <b>Apps &amp; Connectors</b> → <b>Create</b>. Tên: <b>Helmsman</b>, Authentication: <b>OAuth</b>, dán địa chỉ MCP này, tick <b>I trust this application</b> rồi bấm <b>Create</b>.', 'Back in <b>Apps &amp; Connectors</b> → <b>Create</b>. Name: <b>Helmsman</b>, Authentication: <b>OAuth</b>, paste this MCP URL, tick <b>I trust this application</b> and click <b>Create</b>.'), copyBox(mcpUrl))}
${PASTE_CODE('ChatGPT')}
${step(bi('Dùng trong chat', 'Use it in a chat'), bi('Trong chat mới, bấm <b>+</b> → <b>More</b> → <b>Developer mode</b> và chọn <b>Helmsman</b>. Khi ChatGPT hỏi xác nhận một hành động, chọn cho phép; nếu có tuỳ chọn ghi nhớ, bật nó để không bị hỏi lại mỗi lần.', 'In a new chat, click <b>+</b> → <b>More</b> → <b>Developer mode</b> and pick <b>Helmsman</b>. When ChatGPT asks you to confirm an action, allow it; if it offers to remember the choice, turn that on so it stops asking every time.'))}
</ol>`,
    },
    {
      id: 'claude',
      name: 'Claude',
      steps: `<ol class="steps">${GET_CODE}
${step(bi('Thêm connector', 'Add the connector'), bi('claude.ai hoặc Claude Desktop → <b>Settings</b> → <b>Connectors</b> → <b>Add custom connector</b>. Tên: <b>Helmsman</b>, dán địa chỉ MCP này rồi bấm <b>Add</b>.', 'claude.ai or Claude Desktop → <b>Settings</b> → <b>Connectors</b> → <b>Add custom connector</b>. Name: <b>Helmsman</b>, paste this MCP URL and click <b>Add</b>.'), copyBox(mcpUrl))}
${step(bi('Kết nối', 'Connect'), bi('Bấm <b>Connect</b> bên cạnh Helmsman. Claude mở trang của Helmsman: dán mã rồi bấm <b>Cho phép</b>.', 'Click <b>Connect</b> next to Helmsman. Claude opens a Helmsman page: paste the code and click <b>Allow</b>.'))}
${step(bi('Cho phép đầy đủ', 'Allow full access'), bi('Trong <b>Settings</b> → <b>Connectors</b> → <b>Helmsman</b>, đặt quyền các tool là <b>Always allow</b> để Claude không hỏi trước mỗi lần dùng. Trong chat, bật Helmsman ở menu <b>Search and tools</b>.', 'In <b>Settings</b> → <b>Connectors</b> → <b>Helmsman</b>, set the tool permissions to <b>Always allow</b> so Claude stops asking before each use. In a chat, turn Helmsman on in the <b>Search and tools</b> menu.'))}
</ol>${tip('Connector gắn với tài khoản Claude, nên dùng được cả trên claude.ai lẫn Claude Desktop.', 'The connector belongs to your Claude account, so it works in both claude.ai and Claude Desktop.')}`,
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      steps: `<ol class="steps">${step(bi('Thêm server', 'Add the server'), bi('Chạy lệnh này trong terminal:', 'Run this in a terminal:'), copyBox(`claude mcp add helmsman -- ${command}`))}
${LOCAL_CHECK}
${step(bi('Cho phép đầy đủ', 'Allow full access'), bi('Khi Claude Code hỏi dùng tool Helmsman, chọn <b>Yes, and don’t ask again</b>. Hoặc thêm <code>"mcp__helmsman"</code> vào <code>permissions.allow</code> trong <code>.claude/settings.json</code>.', 'When Claude Code asks to use a Helmsman tool, pick <b>Yes, and don’t ask again</b>. Or add <code>"mcp__helmsman"</code> to <code>permissions.allow</code> in <code>.claude/settings.json</code>.'))}
</ol>`,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      steps: `<ol class="steps">${step(bi('Thêm server', 'Add the server'), bi('<b>Cursor Settings</b> → <b>MCP</b> → <b>Add new MCP server</b>, hoặc sửa <code>~/.cursor/mcp.json</code>, rồi dán:', '<b>Cursor Settings</b> → <b>MCP</b> → <b>Add new MCP server</b>, or edit <code>~/.cursor/mcp.json</code>, and paste:'), copyBox(localSnippet(publicUrl)))}
${LOCAL_CHECK}
${step(bi('Cho phép đầy đủ', 'Allow full access'), bi('Trong <b>Cursor Settings</b> → <b>Agent</b>, bật chế độ tự chạy tool (auto-run) để không phải bấm <b>Run</b> cho từng lệnh.', 'In <b>Cursor Settings</b> → <b>Agent</b>, turn on auto-run for tools so you don’t have to click <b>Run</b> for each call.'))}
</ol>`,
    },
    {
      id: 'vscode',
      name: 'VS Code',
      steps: `<ol class="steps">${step(bi('Thêm server', 'Add the server'), bi('Tạo <code>.vscode/mcp.json</code> (hoặc chạy <b>MCP: Add Server</b> trong Command Palette) với nội dung:', 'Create <code>.vscode/mcp.json</code> (or run <b>MCP: Add Server</b> from the Command Palette) with:'), copyBox(vscodeConfig))}
${LOCAL_CHECK}
${step(bi('Cho phép đầy đủ', 'Allow full access'), bi('Dùng Copilot Chat ở chế độ <b>Agent</b>. Khi được hỏi chạy tool Helmsman, mở menu cạnh nút <b>Continue</b> và chọn <b>Always allow</b>.', 'Use Copilot Chat in <b>Agent</b> mode. When asked to run a Helmsman tool, open the menu next to <b>Continue</b> and pick <b>Always allow</b>.'))}
</ol>`,
    },
    {
      id: 'codex',
      name: 'Codex',
      steps: `<ol class="steps">${step(bi('Thêm server', 'Add the server'), bi('Thêm vào <code>~/.codex/config.toml</code>:', 'Add to <code>~/.codex/config.toml</code>:'), copyBox(codexConfig))}
${LOCAL_CHECK}
</ol>`,
    },
  ];
}

const DOWNLOAD = `<div class="row" style="margin-top:12px"><a class="btn" href="/browser-use-bridge.zip" download>${bi('Tải extension (.zip)', 'Download extension (.zip)')}</a></div>`;

const tabItem = `${segmentedItemClass} h-8 px-3 text-[13px]`;

export function landingPage(publicUrl: string): string {
  copyIds = 0;
  const list = clients(publicUrl);
  const tabs = list
    .map((c, i) => `<button type="button" role="tab" class="${tabItem}" data-tab="${c.id}" data-state="${i ? 'off' : 'on'}" aria-selected="${!i}" aria-controls="panel-${c.id}" tabindex="${i ? -1 : 0}">${c.name}</button>`)
    .join('');
  const panels = list.map((c, i) => `<section role="tabpanel" id="panel-${c.id}" aria-label="${c.name}"${i ? ' hidden' : ''}>${c.steps}</section>`).join('\n');
  return layout(
    'Helmsman',
    `<section class="hero"><h1>Helmsman</h1>
<p class="muted">${bi('Cho ChatGPT, Claude và các AI khác dùng Chrome của bạn: đọc trang, bấm, gõ, điền form.', 'Let ChatGPT, Claude and other AI assistants use your Chrome: read pages, click, type and fill forms.')}</p>
</section>
<div class="card"><ol class="steps">
${step(bi('Cài extension', 'Install the extension'), bi('Tải file zip rồi giải nén. Mở <code>chrome://extensions</code>, bật <b>Developer mode</b>, bấm <b>Load unpacked</b> và chọn thư mục đó.', 'Download the zip and unzip it. Open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the folder.'), DOWNLOAD)}
</ol></div>
<h2 class="section-title">${bi('Kết nối với AI của bạn', 'Connect your AI')}</h2>
<div class="card" data-tabs><div role="tablist" aria-label="AI" class="${segmentedClass} tablist">${tabs}</div>
${panels}</div>
${footer}`,
  );
}

/** A live demo: the extension's real cursor, agent bar and confirmation card driven over a sample form. */
export function demoPage(): string {
  return layout(
    'Helmsman – Demo',
    `<section class="hero"><h1 id="demo-title">${bi('Xem thử con trỏ', 'Try the cursor')}</h1>
<p class="muted">${bi('Đây đúng là con trỏ, thanh Dừng và hộp xác nhận mà AI dùng trong Chrome của bạn. Bấm <b>Chạy thử</b> để xem một lượt điền form; bấm <b>Dừng</b> trên thanh để ngắt giữa chừng.', 'This is the same cursor, Stop bar and confirmation card the AI uses in your Chrome. Press <b>Run demo</b> to watch it fill a form; press <b>Stop</b> on the bar to interrupt.')}</p>
<button type="button" class="btn" id="demo-run">${bi('Chạy thử', 'Run demo')}</button></section>
<div class="card"><h2>${bi('Liên hệ', 'Contact us')}</h2>
<label class="field"><b>${bi('Họ tên', 'Name')}</b><input id="demo-name" autocomplete="off"></label>
<label class="field"><b>Email</b><input id="demo-email" autocomplete="off"></label>
<div class="row"><button type="button" class="btn" id="demo-send">${bi('Gửi', 'Send')}</button><span id="demo-result" class="muted" style="align-self:center"></span></div></div>
<script src="/demo.js" defer></script>
${footer}`,
  );
}

export const REPO_URL = 'https://github.com/BillyND/browser-use-bridge';

const footer = `<footer><a href="/demo">${bi('Xem demo', 'Demo')}</a><a href="/privacy">${bi('Chính sách quyền riêng tư', 'Privacy policy')}</a><a href="${REPO_URL}">GitHub</a></footer>`;

/** Privacy policy for the Chrome Web Store listing: same layout, EN and VI toggled like the landing. */
export function privacyPage(): string {
  const issues = `<a class="link" href="${REPO_URL}/issues">${REPO_URL.replace('https://', '')}/issues</a>`;
  return layout(
    'Helmsman – Privacy policy',
    `<section class="hero"><h1>${bi('Chính sách quyền riêng tư', 'Privacy policy')}</h1>
<p class="muted">${bi('Cập nhật lần cuối: 12/11/2026', 'Last updated: 12 November 2026')}</p></section>
<div class="card prose">
<p>${bi(
      'Helmsman là extension Chrome cho phép trợ lý AI <b>của chính bạn</b> (ChatGPT, Claude, Cursor…) đọc và điều khiển các tab trình duyệt của bạn. Chúng tôi không có tài khoản người dùng, không có quảng cáo, không bán hay chia sẻ dữ liệu, và không dùng dữ liệu của bạn để huấn luyện mô hình.',
      'Helmsman is a Chrome extension that lets <b>your own</b> AI assistant (ChatGPT, Claude, Cursor…) read and control your browser tabs. There are no user accounts, no ads, we never sell or share data, and we never use your data to train models.',
    )}</p>

<h2>${bi('1. Dữ liệu được xử lý', '1. Data that is processed')}</h2>
<ul>
<li>${bi(
      '<b>Nội dung trang</b> (cây truy cập, chữ, ảnh chụp màn hình, URL, tiêu đề tab) chỉ được đọc khi trợ lý AI của bạn gọi một tool, rồi gửi <b>duy nhất</b> tới client AI mà bạn đã kết nối. Extension không gửi nội dung trang tới máy chủ của chúng tôi hay bất kỳ bên thứ ba nào khác.',
      '<b>Page content</b> (accessibility tree, text, screenshots, URLs, tab titles) is read only when your AI assistant calls a tool, and is sent <b>only</b> to the AI client you connected. The extension sends page content to no server of ours and to no other third party.',
    )}</li>
<li>${bi(
      '<b>Chế độ đám mây</b>: gateway (Cloudflare Worker) chỉ chuyển tiếp lệnh và kết quả giữa client AI và Chrome của bạn. Gateway <b>không lưu</b> nội dung trang, kết quả tool hay lịch sử lệnh; dữ liệu chỉ đi qua bộ nhớ trong lúc xử lý một lệnh.',
      '<b>Cloud mode</b>: the gateway (a Cloudflare Worker) only relays commands and results between the AI client and your Chrome. It <b>does not store</b> page content, tool results or command history; data passes through memory while one command is handled.',
    )}</li>
<li>${bi(
      '<b>Chế độ cục bộ</b>: mọi thứ đi qua WebSocket tới <code>127.0.0.1</code> trên máy bạn, không qua Internet.',
      '<b>Local mode</b>: everything goes over a WebSocket to <code>127.0.0.1</code> on your computer, never over the Internet.',
    )}</li>
</ul>

<h2>${bi('2. Dữ liệu gateway lưu (Cloudflare KV)', '2. What the gateway stores (Cloudflare KV)')}</h2>
<p>${bi('Chỉ những mục sau, không có nội dung duyệt web:', 'Only the following, never any browsing content:')}</p>
<ul>
<li>${bi('Các <b>quyền OAuth</b> (grant, token) mà bạn cấp cho client AI qua trang cho phép.', 'The <b>OAuth grants</b> (grants, tokens) you give an AI client on the consent page.')}</li>
<li>${bi('<b>Mã thiết bị</b> ngẫu nhiên của mỗi Chrome và <b>mã kết nối</b> ghép với nó.', 'A random <b>device id</b> for each Chrome and the <b>connection code</b> paired with it.')}</li>
<li>${bi('Bộ đếm số lần nhập sai mã kết nối theo địa chỉ IP, tự xoá sau 10 phút (chống dò mã).', 'A counter of wrong connection codes per IP address, deleted automatically after 10 minutes (brute-force protection).')}</li>
</ul>
<p>${bi('Bấm <b>Ngắt kết nối Chrome này</b> trong extension sẽ xoá mã thiết bị, mã kết nối và vô hiệu mọi quyền đã cấp cho mã đó.', 'Clicking <b>Disconnect this Chrome</b> in the extension deletes the device id and connection code and invalidates every grant made with that code.')}</p>

<h2>${bi('3. Dữ liệu ở lại trên máy bạn', '3. What stays on your device')}</h2>
<p>${bi(
      'Lưu trong <code>chrome.storage.local</code> của trình duyệt, không bao giờ gửi đi: <b>kho bí mật</b> (tên và giá trị bạn nhập; model chỉ thấy tên, giá trị được che trong mọi kết quả tool), <b>nhật ký kiểm tra</b> (tối đa 2000 dòng, có nút xuất và xoá), tuỳ chọn giao diện/ngôn ngữ và các <b>quy trình đã lưu</b>.',
      'Kept in the browser\'s <code>chrome.storage.local</code> and never sent anywhere: the <b>secrets vault</b> (names and values you enter; the model sees only names, and values are masked in every tool result), the <b>audit log</b> (up to 2000 entries, with export and clear buttons), interface preferences and <b>saved workflows</b>.',
    )}</p>

<h2>${bi('4. Quyền của extension và mục đích', '4. Extension permissions and why')}</h2>
<table>
<tr><th><code>debugger</code></th><td>${bi('Gửi sự kiện chuột, phím, chụp màn hình, in PDF và hộp thoại JS như người dùng thật.', 'Send real mouse and keyboard events, screenshots, PDF export and JS dialog handling.')}</td></tr>
<tr><th><code>tabs</code>, <code>tabGroups</code></th><td>${bi('Liệt kê, mở, đóng tab và gom tab của từng agent vào một nhóm riêng.', 'List, open and close tabs, and keep each agent\'s tabs in its own group.')}</td></tr>
<tr><th><code>scripting</code>, <code>webNavigation</code></th><td>${bi('Đọc trang và iframe, theo dõi điều hướng.', 'Read pages and iframes and follow navigation.')}</td></tr>
<tr><th><code>storage</code>, <code>alarms</code></th><td>${bi('Lưu cài đặt cục bộ; giữ kết nối và dọn phiên không dùng.', 'Keep local settings; keep the connection alive and clean up idle sessions.')}</td></tr>
<tr><th><code>downloads</code></th><td>${bi('Tải file hoặc PDF khi AI yêu cầu.', 'Download files or PDFs when the AI asks.')}</td></tr>
<tr><th><code>cookies</code>, <code>history</code></th><td>${bi('Chỉ dùng khi AI gọi tool <code>browser_cookies</code> / <code>browser_history</code>; kết quả chỉ về client AI của bạn.', 'Used only when the AI calls <code>browser_cookies</code> / <code>browser_history</code>; results go only to your AI client.')}</td></tr>
<tr><th>&lt;all_urls&gt;</th><td>${bi('AI có toàn quyền làm việc trên mọi trang, không cần hỏi lại. Bạn dừng nó bất cứ lúc nào bằng nút Dừng.', 'The AI has full access to work on any site without asking. You can stop it at any time with the Stop button.')}</td></tr>
</table>
<p>${bi('Extension không tải hay chạy mã từ xa; toàn bộ mã nằm trong gói cài đặt.', 'The extension loads and runs no remote code; all code ships in the package.')}</p>

<h2>${bi('5. Lưu giữ', '5. Retention')}</h2>
<p>${bi(
      'Gateway không lưu nội dung trang nên không có gì để giữ. Mã thiết bị, mã kết nối và quyền OAuth được giữ tới khi bạn ngắt kết nối. Dữ liệu cục bộ giữ tới khi bạn xoá nó hoặc gỡ extension.',
      'The gateway keeps no page content, so there is nothing to retain. Device ids, connection codes and OAuth grants are kept until you disconnect. Local data is kept until you delete it or uninstall the extension.',
    )}</p>

<h2>${bi('6. Chia sẻ và bên thứ ba', '6. Sharing and third parties')}</h2>
<p>${bi(
      'Chúng tôi không bán, cho thuê hay chia sẻ dữ liệu. Client AI bạn chọn (ví dụ ChatGPT hoặc Claude) nhận nội dung trang mà tool trả về và xử lý theo chính sách của họ. Hạ tầng chạy trên Cloudflare Workers.',
      'We never sell, rent or share data. The AI client you choose (for example ChatGPT or Claude) receives what the tools return and handles it under its own policy. The infrastructure runs on Cloudflare Workers.',
    )}</p>

<h2>${bi('7. Bảo vệ người dùng', '7. Safeguards')}</h2>
<p>${bi(
      'Helmsman luôn chạy với toàn quyền: AI tự làm mọi việc mà không hỏi lại. Chữ lấy từ trang được gắn nhãn là dữ liệu không đáng tin để chống prompt injection; giá trị trong kho bí mật được che trong mọi kết quả; nút <b>Dừng</b> trên trang kết thúc việc AI đang làm ngay lập tức.',
      'Helmsman always runs with full access: the AI does everything without asking. Page text is labelled untrusted to resist prompt injection; secret values are masked in every result; the <b>Stop</b> button on the page ends what the AI is doing at once.',
    )}</p>

<h2>${bi('8. Thay đổi và liên hệ', '8. Changes and contact')}</h2>
<p>${bi('Khi chính sách thay đổi, ngày cập nhật ở trên sẽ đổi. Câu hỏi hoặc yêu cầu về dữ liệu: mở một issue tại', 'If this policy changes, the date above changes. Questions or data requests: open an issue at')} ${issues}.</p>
</div>
${footer}`,
  );
}

export interface ConsentView {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  handle: string;
  error?: string;
}

export function consentPage(v: ConsentView): string {
  const name = escapeHtml(v.clientName);
  const domain = v.clientDomain ? escapeHtml(v.clientDomain) : '';
  const origin = v.clientDomain
    ? bi('Ứng dụng của <b>{domain}</b>.', 'An app from <b>{domain}</b>.', { domain })
    : bi('Ứng dụng tự đăng ký, chưa được xác minh.', 'Self-registered app, not verified.');
  return layout(
    'Helmsman',
    `<div class="card"><h2>${bi('Cho phép <b>{name}</b> điều khiển Chrome của bạn?', 'Allow <b>{name}</b> to control your Chrome?', { name })}</h2>
<p class="muted" style="margin:0">${origin} ${bi('Quyền truy cập sẽ gửi tới', 'Access will be sent to')} <b>${escapeHtml(v.redirectHost)}</b>.</p>
${v.redirectIsLoopback ? `<p class="notice">${bi('Quyền sẽ gửi tới một ứng dụng trên máy này. Chỉ tiếp tục nếu bạn vừa bấm kết nối từ ứng dụng đó.', 'Access goes to an app on this computer. Continue only if you just started the connection from that app.')}</p>` : ''}
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(v.handle)}">
<input type="hidden" name="client_name" value="${escapeHtml(v.clientName)}">
<input type="hidden" name="client_domain" value="${escapeHtml(v.clientDomain ?? '')}">
<input type="hidden" name="redirect_host" value="${escapeHtml(v.redirectHost)}">
<input type="hidden" name="redirect_loopback" value="${v.redirectIsLoopback ? '1' : ''}">
<label class="field"><b>${bi('Mã kết nối', 'Connection code')}</b><span class="muted">${bi('Bấm biểu tượng extension trên Chrome để xem mã.', 'Click the extension icon in Chrome to see it.')}</span>
<input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX" autofocus></label>
${v.error ? `<p class="error" role="alert">${known(v.error)}</p>` : ''}
<div class="row"><button class="btn" name="decision" value="approve">${bi('Cho phép', 'Allow')}</button>
<button class="btn outline" name="decision" value="deny" formnovalidate>${bi('Từ chối', 'Deny')}</button></div>
</form></div>`,
  );
}

export function messagePage(title: string, message: string, ok = false, status = ok ? 200 : 400): Response {
  return new Response(
    layout(title, `<div class="card"><div class="big">${ok ? '✓' : '!'}</div><h2>${known(title)}</h2><p class="muted" style="margin:0">${known(message)}</p></div>`),
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } },
  );
}
