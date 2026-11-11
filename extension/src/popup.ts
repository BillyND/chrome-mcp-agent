import type { PopupState, RuntimeMessage } from './messages';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUS_TEXT: Record<PopupState['status'], string> = {
  'signed-out': 'Chưa đăng nhập',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  offline: 'Ngoại tuyến',
  replaced: 'Đang ở Chrome khác',
  'not-allowed': 'Cần mật khẩu',
};

const TOOL_LABEL: Record<string, [string, string]> = {
  browser_tabs: ['🗂', 'Tab'],
  browser_navigate: ['🧭', 'Mở trang'],
  browser_snapshot: ['👀', 'Đọc trang'],
  browser_click: ['👆', 'Bấm'],
  browser_hover: ['🖱', 'Rê chuột'],
  browser_type: ['⌨️', 'Gõ'],
  browser_fill_form: ['📝', 'Điền form'],
  browser_select_option: ['☑️', 'Chọn'],
  browser_press_key: ['⌨️', 'Phím'],
  browser_scroll: ['↕️', 'Cuộn'],
  browser_drag: ['✋', 'Kéo thả'],
  browser_screenshot: ['📸', 'Chụp màn hình'],
  browser_get_text: ['📖', 'Đọc chữ'],
  browser_evaluate: ['⚙️', 'Script'],
  browser_wait_for: ['⏳', 'Chờ'],
  browser_handle_dialog: ['💬', 'Hộp thoại'],
  browser_file_upload: ['📎', 'Tải file lên'],
  browser_download: ['⬇️', 'Tải về'],
  browser_console_messages: ['🧾', 'Console'],
  browser_network_requests: ['🌐', 'Network'],
};

const send = (msg: RuntimeMessage) => chrome.runtime.sendMessage(msg);

function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}p`;
  return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

async function render() {
  const s = (await send({ type: 'get-state' })) as PopupState;
  const signedIn = !!s.code;
  $('signed-out').hidden = signedIn;
  $('signed-in').hidden = !signedIn;
  if (!signedIn) {
    const err = $('login-error');
    err.hidden = !s.lastError;
    err.textContent = s.lastError ?? '';
    $('password-field').hidden = !s.needsPassword;
    const busy = s.status === 'connecting';
    $<HTMLButtonElement>('login').disabled = busy;
    $('login').textContent = busy ? 'Đang kết nối…' : 'Kết nối Chrome này';
    return;
  }
  $('code').textContent = s.code!;
  const status = $('status');
  status.className = `status ${s.status}`;
  $('status-text').textContent = STATUS_TEXT[s.status];
  const hint = $('status-error');
  hint.hidden = !s.lastError || s.status === 'connected';
  hint.textContent = s.lastError ?? '';
  $('use-here').hidden = s.status !== 'replaced';
  $('paused-card').hidden = !s.paused;
  $<HTMLInputElement>('enabled').checked = s.enabled;
  $('mcp-url').textContent = `${s.gateway}/mcp`;
  $('stop').hidden = s.paused;

  const log = $('log');
  log.innerHTML = '';
  if (!s.log.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Chưa có hoạt động. Hãy nhờ ChatGPT làm gì đó trong Chrome!';
    log.appendChild(li);
  }
  for (const e of s.log) {
    const [icon, label] = TOOL_LABEL[e.tool] ?? ['•', e.tool];
    const li = document.createElement('li');
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = e.ok ? icon : '⚠️';
    const tx = document.createElement('span');
    tx.className = 'tx';
    tx.textContent = `${label}: ${e.summary}`;
    tx.title = e.summary;
    const tm = document.createElement('span');
    tm.className = 'tm';
    tm.textContent = timeAgo(e.t);
    li.append(ic, tx, tm);
    log.appendChild(li);
  }
}

if (new URLSearchParams(location.search).has('welcome')) document.body.classList.add('page');
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('login').addEventListener('click', () =>
  void send({ type: 'connect', password: $<HTMLInputElement>('password').value }),
);
$<HTMLInputElement>('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('login').click();
});
$('copy-code').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('code').textContent ?? '');
  $('copy-code').textContent = 'Đã copy ✓';
  setTimeout(() => ($('copy-code').textContent = 'Copy'), 1500);
});
$('logout').addEventListener('click', () => void send({ type: 'logout' }));
$('stop').addEventListener('click', () => void send({ type: 'stop' }));
$('resume').addEventListener('click', () => void send({ type: 'resume' }));
$('use-here').addEventListener('click', () => void send({ type: 'reconnect' }));
$<HTMLInputElement>('enabled').addEventListener('change', (e) =>
  void send({ type: 'set-enabled', enabled: (e.target as HTMLInputElement).checked }),
);
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('mcp-url').textContent ?? '');
  $('copy').textContent = 'Đã copy ✓';
  setTimeout(() => ($('copy').textContent = 'Copy'), 1500);
});
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === 'state-changed') void render();
});
void render();
setInterval(() => void render(), 5000);
