// UI strings (English and Vietnamese) and the user's language/theme preferences,
// shared by the popup and the in-page overlay.

export type Lang = 'en' | 'vi';
export type Theme = 'light' | 'dark' | 'system';

const en = {
  tagline: 'Let ChatGPT use your Chrome',
  connect: 'Connect',
  connecting: 'Connecting…',
  password: 'Group password',
  code: 'Connection code',
  mcpUrl: 'MCP URL',
  copy: 'Copy',
  copied: 'Copied',
  howTo: 'How to connect',
  allow: 'Allow AI control',
  stop: 'Stop',
  resume: 'Resume',
  useHere: 'Use this Chrome',
  activity: 'Activity',
  noActivity: 'Nothing yet',
  disconnect: 'Disconnect',
  status_connected: 'Connected',
  status_connecting: 'Connecting',
  status_offline: 'Offline',
  status_replaced: 'In use elsewhere',
  'status_not-allowed': 'Password needed',
  'status_signed-out': 'Not connected',
  paused: 'Paused',
  status_off: 'Off',
  localMode: 'Local mode',
  localWaiting: 'Waiting for local server',
  localHint: 'Add this to Claude Desktop, Cursor, Claude Code…',
  err_offline: 'No internet connection.',
  err_revoked: 'This Chrome was disconnected. Connect again.',
  err_replaced: 'Connected from another Chrome.',
  err_network: 'Can’t reach the server.',
  err_wrong_password: 'Wrong password.',
  err_server: 'Server refused. Try again later.',
  bar_working: 'Agent is working',
  bar_paused: 'Agent paused',
  secrets: 'Secrets',
  secretsHint: 'Saved only in this browser. The AI types them as {{secret:NAME}} and never sees the value.',
  noSecrets: 'No secrets yet',
  secretName: 'Name, e.g. GITHUB_PASSWORD',
  secretValue: 'Value',
  secretSave: 'Save secret',
  secretDelete: 'Delete',
  secretInvalid: 'Use a name of letters, digits, _ . - and a value of at least {n} characters.',
};

const vi: typeof en = {
  tagline: 'Cho ChatGPT dùng Chrome của bạn',
  connect: 'Kết nối',
  connecting: 'Đang kết nối…',
  password: 'Mật khẩu nhóm',
  code: 'Mã kết nối',
  mcpUrl: 'URL MCP',
  copy: 'Copy',
  copied: 'Đã copy',
  howTo: 'Cách kết nối',
  allow: 'Cho phép AI điều khiển',
  stop: 'Dừng',
  resume: 'Tiếp tục',
  useHere: 'Dùng Chrome này',
  activity: 'Hoạt động',
  noActivity: 'Chưa có gì',
  disconnect: 'Ngắt kết nối',
  status_connected: 'Đã kết nối',
  status_connecting: 'Đang kết nối',
  status_offline: 'Ngoại tuyến',
  status_replaced: 'Đang dùng ở nơi khác',
  'status_not-allowed': 'Cần mật khẩu',
  'status_signed-out': 'Chưa kết nối',
  paused: 'Đã dừng',
  status_off: 'Tắt',
  localMode: 'Chế độ cục bộ',
  localWaiting: 'Đang chờ server cục bộ',
  localHint: 'Thêm vào Claude Desktop, Cursor, Claude Code…',
  err_offline: 'Mất kết nối mạng.',
  err_revoked: 'Chrome này đã bị ngắt. Kết nối lại nhé.',
  err_replaced: 'Đang kết nối từ một Chrome khác.',
  err_network: 'Không tới được máy chủ.',
  err_wrong_password: 'Sai mật khẩu.',
  err_server: 'Máy chủ từ chối. Thử lại sau.',
  bar_working: 'Agent đang làm việc',
  bar_paused: 'Agent đã dừng',
  secrets: 'Bí mật',
  secretsHint: 'Chỉ lưu trong trình duyệt này. AI gõ chúng bằng {{secret:TÊN}} và không bao giờ thấy giá trị.',
  noSecrets: 'Chưa có bí mật nào',
  secretName: 'Tên, ví dụ GITHUB_PASSWORD',
  secretValue: 'Giá trị',
  secretSave: 'Lưu',
  secretDelete: 'Xóa',
  secretInvalid: 'Tên gồm chữ, số, _ . - và giá trị từ {n} ký tự trở lên.',
};

export type Key = keyof typeof en;
const dict: Record<Lang, typeof en> = { en, vi };

export interface Prefs {
  lang: Lang;
  theme: Theme;
}

export async function getPrefs(): Promise<Prefs> {
  const { prefs } = await chrome.storage.local.get('prefs');
  const p = (prefs ?? {}) as Partial<Prefs>;
  const browserLang: Lang = (navigator.language || 'en').toLowerCase().startsWith('vi') ? 'vi' : 'en';
  return { lang: p.lang ?? browserLang, theme: p.theme ?? 'light' };
}

export async function setPrefs(next: Partial<Prefs>): Promise<Prefs> {
  const merged = { ...(await getPrefs()), ...next };
  await chrome.storage.local.set({ prefs: merged });
  return merged;
}

export function t(lang: Lang, key: Key): string {
  return dict[lang][key] ?? en[key];
}

/** Resolves "system" to the OS setting. */
export function isDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
