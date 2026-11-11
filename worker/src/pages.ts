// Server-rendered pages: landing (setup guide), consent, and result messages.
// Everything is inline so a page is one request and works without JS.

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--text:#14161f;--muted:#5d6475;--line:#e3e6ef;--accent:#4f46e5;--accent-2:#7c3aed;--ok:#0f9d58;--warn:#b45309;--danger:#dc2626;--code:#f1f2f8}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f16;--card:#151824;--text:#eceef6;--muted:#9aa1b5;--line:#272b3b;--accent:#818cf8;--accent-2:#a78bfa;--ok:#34d399;--warn:#fbbf24;--danger:#f87171;--code:#1d2131}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:40px 16px 64px}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;color:#fff;box-shadow:0 6px 20px -6px var(--accent)}
.brand h1{font-size:20px;margin:0;letter-spacing:-.01em}.brand p{margin:0;color:var(--muted);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:16px}
h2{font-size:17px;margin:0 0 6px}
.muted{color:var(--muted)}
.steps{list-style:none;padding:0;margin:0;counter-reset:s}
.steps li{counter-increment:s;position:relative;padding:0 0 18px 44px}
.steps li:last-child{padding-bottom:0}
.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--code);color:var(--accent);font-weight:700;display:grid;place-items:center;font-size:13px}
.steps b{display:block}
.url{display:flex;gap:8px;margin-top:10px}
.url code{flex:1;min-width:0;overflow:auto;white-space:nowrap;background:var(--code);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
button,.btn{appearance:none;border:0;border-radius:10px;padding:10px 16px;font:600 14px inherit;font-family:inherit;cursor:pointer;background:var(--accent);color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
button.secondary{background:var(--code);color:var(--text);border:1px solid var(--line)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--code);color:var(--muted)}
.notice{border-left:3px solid var(--warn);padding:10px 14px;background:var(--code);border-radius:8px;font-size:14px}
.big{font-size:44px;line-height:1;margin-bottom:12px}
.field{display:flex;flex-direction:column;gap:4px;margin-top:16px}
.field input{font:600 20px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--code);color:var(--text)}
.field input:focus{outline:2px solid var(--accent);outline-offset:1px}
.error{color:var(--danger);font-weight:600}
footer{text-align:center;color:var(--muted);font-size:12px;margin-top:24px}
`;

const LOGO = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l7 17 2.5-7L21 10.5z"/></svg>`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>
<div class="brand"><div class="logo">${LOGO}</div><div><h1>Chrome MCP Agent</h1><p>Cho ChatGPT dùng Chrome của bạn</p></div></div>
${body}
<footer>Chrome MCP Agent · mỗi mã kết nối chỉ điều khiển đúng một Chrome</footer>
</main></body></html>`;
}

export function landingPage(publicUrl: string): string {
  const mcpUrl = `${publicUrl}/mcp`;
  return layout(
    'Chrome MCP Agent',
    `<div class="card"><h2>Cài đặt trong 3 bước</h2><p class="muted">Không cần cài phần mềm nào khác. Làm một lần là dùng mãi.</p>
<ol class="steps">
<li><b>Tải và cài extension</b>
<div class="row" style="margin:8px 0 10px"><a class="btn" href="/chrome-mcp-agent.zip" download>⬇ Tải extension (.zip)</a></div>
<span class="muted">Giải nén file vừa tải. Mở <code>chrome://extensions</code>, bật <b>Developer mode</b> (góc phải trên), bấm <b>Load unpacked</b> và chọn thư mục vừa giải nén. Cuối cùng ghim biểu tượng con trỏ tím lên thanh công cụ.</span></li>
<li><b>Bấm biểu tượng → "Kết nối"</b><span class="muted">Thấy chấm xanh <span class="pill">● Đã kết nối</span> và một <b>mã kết nối</b> (ví dụ <code>K7QX2-MN4PD</code>) là xong.</span></li>
<li><b>Thêm vào ChatGPT</b><span class="muted">ChatGPT → Cài đặt → Apps &amp; Connectors → Advanced → bật Developer mode → Create. Dán địa chỉ này, chọn OAuth. Khi ChatGPT mở trang cho phép, dán mã kết nối của bạn vào:</span>
<div class="url"><code id="u">${escapeHtml(mcpUrl)}</code><button class="secondary" onclick="navigator.clipboard.writeText(document.getElementById('u').textContent);this.textContent='Đã copy ✓'">Copy</button></div></li>
</ol></div>
<div class="card"><h2>Dùng thử</h2><p class="muted">Trong ChatGPT, bật connector Chrome MCP Agent rồi nhắn:</p>
<p><code>Mở tab Gmail của tôi và tóm tắt 5 email mới nhất</code></p>
<p class="muted">Khi AI đang làm, Chrome hiện con trỏ tím và thanh "Chrome MCP Agent đang điều khiển" kèm nút <b>Dừng</b>. Dải vàng "đang gỡ lỗi trình duyệt" là bình thường.</p></div>`,
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
  const origin = v.clientDomain
    ? `Ứng dụng của <b>${escapeHtml(v.clientDomain)}</b>.`
    : 'Ứng dụng tự đăng ký, tên chưa được xác minh.';
  return layout(
    'Cho phép truy cập',
    `<div class="card"><h2>Cho phép <b>${escapeHtml(v.clientName)}</b> điều khiển Chrome của bạn?</h2>
<p class="muted">${origin} Quyền truy cập sẽ được gửi tới <b>${escapeHtml(v.redirectHost)}</b>.</p>
${v.redirectIsLoopback ? '<p class="notice">Quyền sẽ gửi tới một ứng dụng trên máy tính này. Chỉ tiếp tục nếu bạn vừa bấm kết nối từ ứng dụng đó.</p>' : ''}
<p>Ứng dụng này sẽ đọc, bấm, gõ và mở trang trong Chrome đang đăng nhập của bạn. Bạn có thể bấm <b>Dừng</b> bất cứ lúc nào.</p>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(v.handle)}">
<input type="hidden" name="client_name" value="${escapeHtml(v.clientName)}">
<input type="hidden" name="client_domain" value="${escapeHtml(v.clientDomain ?? '')}">
<input type="hidden" name="redirect_host" value="${escapeHtml(v.redirectHost)}">
<input type="hidden" name="redirect_loopback" value="${v.redirectIsLoopback ? '1' : ''}">
<label class="field"><b>Mã kết nối</b><span class="muted">Bấm biểu tượng Chrome MCP Agent trên thanh công cụ Chrome để xem mã.</span>
<input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX" autofocus></label>
${v.error ? `<p class="error">${escapeHtml(v.error)}</p>` : ''}
<div class="row"><button name="decision" value="approve">Cho phép</button>
<button class="secondary" name="decision" value="deny" formnovalidate>Từ chối</button></div>
</form></div>`,
  );
}

export function messagePage(title: string, message: string, ok = false, status = ok ? 200 : 400): Response {
  return new Response(
    layout(title, `<div class="card"><div class="big">${ok ? '✅' : '⚠️'}</div><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(message)}</p></div>`),
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } },
  );
}
