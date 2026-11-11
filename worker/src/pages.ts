// Server-rendered pages: landing (setup guide), consent, and result messages.
// Everything is inline so a page is one request and works without JS.

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Both languages are rendered; CSS shows the one matching <html lang>. That keeps the
// consent form fully usable without JS and lets the tiny script switch language/theme.
const bi = (vi: string, en: string) => `<span data-l="vi">${vi}</span><span data-l="en">${en}</span>`;

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

const CSS = `
:root{--radius:.625rem;--background:oklch(1 0 0);--foreground:oklch(.141 .005 285.823);--card:oklch(1 0 0);--primary:oklch(.21 .006 285.885);--primary-foreground:oklch(.985 0 0);--secondary:oklch(.967 .001 286.375);--muted:oklch(.967 .001 286.375);--muted-foreground:oklch(.5 .016 285.938);--destructive:oklch(.577 .245 27.325);--border:oklch(.92 .004 286.32);--input:oklch(.92 .004 286.32);--ring:oklch(.705 .015 286.067);--warning:oklch(.55 .15 70)}
:root.dark{--background:oklch(.141 .005 285.823);--foreground:oklch(.985 0 0);--card:oklch(.21 .006 285.885);--primary:oklch(.92 .004 286.32);--primary-foreground:oklch(.21 .006 285.885);--secondary:oklch(.274 .006 286.033);--muted:oklch(.274 .006 286.033);--muted-foreground:oklch(.72 .015 286.067);--destructive:oklch(.704 .191 22.216);--border:oklch(1 0 0/10%);--input:oklch(1 0 0/15%);--ring:oklch(.552 .016 285.938);--warning:oklch(.8 .15 80)}
html[lang=en] [data-l=vi],html[lang=vi] [data-l=en]{display:none}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:560px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:40px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;min-width:0}
.logo{width:32px;height:32px;border-radius:8px;background:var(--primary);color:var(--primary-foreground);display:grid;place-items:center;flex:none}
.tools{display:flex;gap:8px;flex:none}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:var(--radius);padding:2px;background:var(--muted)}
.seg button{all:unset;cursor:pointer;min-width:28px;height:26px;padding:0 6px;border-radius:calc(var(--radius) - 3px);display:inline-grid;place-items:center;font-size:12px;font-weight:600;color:var(--muted-foreground);box-sizing:border-box}
.seg button[aria-pressed=true]{background:var(--card);color:var(--foreground);box-shadow:0 1px 2px oklch(0 0 0/12%)}
.seg button:focus-visible,.btn:focus-visible,.field input:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 8px}
h2{font-size:18px;line-height:1.3;margin:0 0 8px;letter-spacing:-.01em}
.muted{color:var(--muted-foreground)}
.card{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:24px;box-shadow:0 1px 2px oklch(0 0 0/5%)}
.btn{appearance:none;border:1px solid transparent;border-radius:var(--radius);height:40px;padding:0 18px;font:500 14px/1 inherit;font-family:inherit;cursor:pointer;background:var(--primary);color:var(--primary-foreground);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.btn:hover{opacity:.9}
.btn.outline{background:var(--card);color:var(--foreground);border-color:var(--input)}
.btn.outline:hover{background:var(--secondary);opacity:1}
.btn.sm{height:34px;padding:0 12px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.hero{margin-bottom:28px}.hero p{margin:0 0 20px;font-size:16px}
.steps{list-style:none;padding:0;margin:0;counter-reset:s;display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
.steps li{counter-increment:s;position:relative;padding-left:40px;min-width:0}
.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:var(--secondary);display:grid;place-items:center;font-size:12px;font-weight:600}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--muted);border-radius:6px;padding:2px 6px;overflow-wrap:anywhere}
.url{display:flex;gap:8px;margin-top:10px;align-items:stretch}
.url code{flex:1;min-width:0;overflow:auto;white-space:nowrap;border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;display:flex;align-items:center}
.copy .ok,.copy.done .no{display:none}.copy.done .ok{display:inline}
.notice{border:1px solid var(--warning);color:var(--warning);padding:10px 14px;border-radius:var(--radius);font-size:14px;margin:12px 0}
.who{display:grid;gap:2px;margin:12px 0 4px}
.field{display:flex;flex-direction:column;gap:6px;margin-top:20px;font-size:14px}
.field input{font:600 20px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;height:48px;padding:0 14px;border-radius:var(--radius);border:1px solid var(--input);background:transparent;color:var(--foreground);width:100%}
.error{color:var(--destructive);font-weight:500;margin:12px 0 0;font-size:14px}
.big{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--secondary);margin-bottom:12px;font-size:20px}
.prose h2{margin:28px 0 8px}.prose p,.prose ul{margin:0 0 12px}.prose ul{padding-left:20px}.prose li{margin:4px 0}
.prose table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px}.prose th,.prose td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--border)}.prose th{white-space:nowrap}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
footer a{color:var(--muted-foreground);text-underline-offset:3px}footer a:hover{color:var(--foreground)}
a.link{color:var(--foreground);text-underline-offset:3px}
@media (max-width:420px){h1{font-size:26px}.card{padding:18px}.row .btn{flex:1}}
`;

const LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3l7 17 2.5-7L21 10.5z"/></svg>`;
const SUN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const AUTO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`;

// Runs in <head> before paint (no flash) and wires the toggles once the body exists.
const SCRIPT = `(function(){var d=document.documentElement,S=localStorage,g=function(k){try{return S.getItem(k)}catch(e){return null}},s=function(k,v){try{S.setItem(k,v)}catch(e){}};
var mq=matchMedia('(prefers-color-scheme: dark)');
function lang(){var l=g('cma-lang');return l==='vi'||l==='en'?l:/^vi/i.test(navigator.language||'')?'vi':'en'}
function theme(){var t=g('cma-theme');return t==='dark'||t==='system'?t:'light'}
function apply(){var t=theme();d.lang=lang();d.classList.toggle('dark',t==='dark'||(t==='system'&&mq.matches));
document.querySelectorAll('[data-lang]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.lang===d.lang))});
document.querySelectorAll('[data-theme]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.theme===t))})}
apply();mq.addEventListener&&mq.addEventListener('change',apply);
document.addEventListener('DOMContentLoaded',function(){apply();
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
if(b.dataset.lang){s('cma-lang',b.dataset.lang);apply()}
else if(b.dataset.theme){s('cma-theme',b.dataset.theme);apply()}
else if(b.dataset.copy){var el=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(el.textContent).then(function(){b.classList.add('done');setTimeout(function(){b.classList.remove('done')},1500)})}})})})();`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${CSS}</style><script>${SCRIPT}</script></head><body><main>
<header><div class="brand"><span class="logo">${LOGO}</span>Helmsman</div>
<div class="tools"><div class="seg" role="group" aria-label="Language"><button type="button" data-lang="en" aria-pressed="false">EN</button><button type="button" data-lang="vi" aria-pressed="false">VI</button></div>
<div class="seg" role="group" aria-label="Theme"><button type="button" data-theme="light" aria-label="Light" aria-pressed="true">${SUN}</button><button type="button" data-theme="dark" aria-label="Dark" aria-pressed="false">${MOON}</button><button type="button" data-theme="system" aria-label="System" aria-pressed="false">${AUTO}</button></div></div></header>
${body}
</main></body></html>`;
}

export function landingPage(publicUrl: string): string {
  const mcpUrl = `${publicUrl}/mcp`;
  return layout(
    'Helmsman',
    `<section class="hero"><h1>Helmsman</h1>
<p class="muted">${bi('Cho ChatGPT dùng Chrome của bạn.', 'Let ChatGPT use your Chrome.')}</p>
<a class="btn" href="/chrome-mcp-agent.zip" download>${bi('Tải extension', 'Download extension')}</a>
<p class="muted">${bi('Dùng Claude Desktop, Cursor hay Claude Code? Bật <b>Chế độ cục bộ</b> trong extension, không cần tài khoản.', 'Using Claude Desktop, Cursor or Claude Code? Turn on <b>Local mode</b> in the extension, no account needed.')}</p></section>
<div class="card"><ol class="steps">
<li><b>${bi('Cài extension', 'Install the extension')}</b><div class="muted">${bi(
      'Giải nén file zip. Mở <code>chrome://extensions</code>, bật <b>Developer mode</b>, bấm <b>Load unpacked</b> và chọn thư mục đó.',
      'Unzip the file. Open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the folder.',
    )}</div></li>
<li><b>${bi('Lấy mã kết nối', 'Get a connection code')}</b><div class="muted">${bi(
      'Bấm biểu tượng extension, rồi bấm <b>Kết nối</b> để nhận mã.',
      'Click the extension icon, then <b>Connect</b> to get a code.',
    )}</div></li>
<li><b>${bi('Thêm vào ChatGPT', 'Add it to ChatGPT')}</b><div class="muted">${bi(
      'Cài đặt → Apps &amp; Connectors → Advanced → Developer mode → Create. Dán địa chỉ MCP, chọn OAuth, rồi dán mã kết nối.',
      'Settings → Apps &amp; Connectors → Advanced → Developer mode → Create. Paste the MCP URL, choose OAuth, then paste the code.',
    )}</div>
<div class="url"><code id="u">${escapeHtml(mcpUrl)}</code><button type="button" class="btn outline sm copy" data-copy="u"><span class="no">${bi('Sao chép', 'Copy')}</span><span class="ok">${bi('Đã chép', 'Copied')}</span></button></div></li>
</ol></div>
${footer}`,
  );
}

export const REPO_URL = 'https://github.com/BillyND/chrome-mcp-agent';

const footer = `<footer><a href="/privacy">${bi('Chính sách quyền riêng tư', 'Privacy policy')}</a><a href="${REPO_URL}">GitHub</a></footer>`;

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
      'Lưu trong <code>chrome.storage.local</code> của trình duyệt, không bao giờ gửi đi: <b>kho bí mật</b> (tên và giá trị bạn nhập; model chỉ thấy tên, giá trị được che trong mọi kết quả tool), <b>nhật ký kiểm tra</b> (tối đa 2000 dòng, có nút xuất và xoá), <b>quy tắc theo trang</b>, tuỳ chọn giao diện/ngôn ngữ và các <b>quy trình đã lưu</b>.',
      'Kept in the browser\'s <code>chrome.storage.local</code> and never sent anywhere: the <b>secrets vault</b> (names and values you enter; the model sees only names, and values are masked in every tool result), the <b>audit log</b> (up to 2000 entries, with export and clear buttons), <b>site rules</b>, interface preferences and <b>saved workflows</b>.',
    )}</p>

<h2>${bi('4. Quyền của extension và mục đích', '4. Extension permissions and why')}</h2>
<table>
<tr><th><code>debugger</code></th><td>${bi('Gửi sự kiện chuột, phím, chụp màn hình, in PDF và hộp thoại JS như người dùng thật.', 'Send real mouse and keyboard events, screenshots, PDF export and JS dialog handling.')}</td></tr>
<tr><th><code>tabs</code>, <code>tabGroups</code></th><td>${bi('Liệt kê, mở, đóng tab và gom tab của từng agent vào một nhóm riêng.', 'List, open and close tabs, and keep each agent\'s tabs in its own group.')}</td></tr>
<tr><th><code>scripting</code>, <code>webNavigation</code></th><td>${bi('Đọc trang và iframe, theo dõi điều hướng.', 'Read pages and iframes and follow navigation.')}</td></tr>
<tr><th><code>storage</code>, <code>alarms</code></th><td>${bi('Lưu cài đặt cục bộ; giữ kết nối và dọn phiên không dùng.', 'Keep local settings; keep the connection alive and clean up idle sessions.')}</td></tr>
<tr><th><code>downloads</code></th><td>${bi('Tải file hoặc PDF khi AI yêu cầu và bạn cho phép.', 'Download files or PDFs when the AI asks and you allow it.')}</td></tr>
<tr><th><code>cookies</code>, <code>history</code></th><td>${bi('Chỉ dùng khi AI gọi tool <code>browser_cookies</code> / <code>browser_history</code>; kết quả chỉ về client AI của bạn.', 'Used only when the AI calls <code>browser_cookies</code> / <code>browser_history</code>; results go only to your AI client.')}</td></tr>
<tr><th>&lt;all_urls&gt;</th><td>${bi('AI có thể được yêu cầu làm việc trên bất kỳ trang nào. Bạn kiểm soát bằng quy tắc theo trang, công tắc Dừng và hộp thoại xác nhận.', 'The AI may be asked to work on any site. You stay in control with site rules, the Stop switch and confirmation prompts.')}</td></tr>
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
      'Hành động nhạy cảm (gửi, thanh toán, xoá, tải lên…) luôn hỏi bạn; số thẻ và giấy tờ tuỳ thân bị chặn; chữ lấy từ trang được gắn nhãn là dữ liệu không đáng tin để chống prompt injection; công tắc <b>Cho phép AI điều khiển</b> dừng AI ngay lập tức.',
      'Sensitive actions (submit, pay, delete, upload…) always ask you; card numbers and ID numbers are blocked; page text is labelled untrusted to resist prompt injection; the <b>Allow AI control</b> switch stops the AI immediately.',
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
    ? bi(`Ứng dụng của <b>${domain}</b>.`, `An app from <b>${domain}</b>.`)
    : bi('Ứng dụng tự đăng ký, chưa được xác minh.', 'Self-registered app, not verified.');
  return layout(
    'Helmsman',
    `<div class="card"><h2>${bi(`Cho phép <b>${name}</b> điều khiển Chrome của bạn?`, `Allow <b>${name}</b> to control your Chrome?`)}</h2>
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
