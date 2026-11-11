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
</ol></div>`,
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
