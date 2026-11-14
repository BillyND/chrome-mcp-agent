// UI strings (English and Vietnamese here, the other languages in ./locales) and the user's language/theme
// preferences, shared by the popup and the in-page overlay.

import { isLang, matchLang, type Lang } from '../../shared/langs';
import { de, es, fr, id, ja, ko, pt, ru, th, zh } from './locales';

export type { Lang };
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
  disconnect: 'Disconnect',
  disconnecting: 'Disconnecting…',
  status_connected: 'Connected',
  status_connecting: 'Connecting',
  status_offline: 'Offline',
  status_replaced: 'In use elsewhere',
  'status_not-allowed': 'Password needed',
  'status_signed-out': 'Not connected',
  paused: 'Paused',
  status_off: 'Off',
  localMode: 'Local mode',
  language: 'Language',
  theme: 'Theme',
  theme_light: 'Light',
  theme_dark: 'Dark',
  theme_system: 'System',
  localWaiting: 'Waiting for local server',
  localHint: 'Add this to the MCP config of Claude Desktop, Cursor or another client:',
  err_offline: 'No internet connection.',
  err_revoked: 'This Chrome was disconnected. Connect again.',
  err_replaced: 'Connected from another Chrome.',
  err_network: 'Can’t reach the server.',
  err_wrong_password: 'Wrong password.',
  err_server: 'Server refused. Try again later.',
  bar_working: 'Agent is working',
  bar_paused: 'Agent paused',
  prompt_handback: 'Agent needs you: {reason}',
  prompt_handback_detail: '{agent} on {host} is waiting. Press Done when you have finished.',
  choice_done: 'Done',
  choice_cancel: 'Cancel',
  pending: 'Waiting for you',
  audit: 'Audit log',
  audit_title: 'Audit log',
  audit_sub: 'Every tool call the agents made, newest first. Stored only on this computer.',
  audit_export: 'Export JSON',
  audit_clear: 'Clear',
  audit_empty: 'No calls recorded yet',
  audit_time: 'Time',
  audit_agent: 'Agent',
  audit_tool: 'Tool',
  audit_site: 'Site',
  audit_result: 'Result',
  audit_approval: 'Answer',
  outcome_ok: 'Done',
  outcome_error: 'Failed',
  outcome_blocked: 'Blocked',
  outcome_declined: 'Declined',
  approval_approved: 'Approved',
  approval_declined: 'Declined',
  approval_timeout: 'Timed out',
  secrets: 'Secrets',
  secretsHint: 'Saved only in this browser. The AI never sees the values.',
  noSecrets: 'No secrets yet',
  secretName: 'Name, e.g. GITHUB_PASSWORD',
  secretValue: 'Value',
  secretSave: 'Save secret',
  secretDelete: 'Delete',
  secretInvalid: 'Enter a name and a value.',
  secretNameAs: 'Saved as',
  secretShort: 'Very short values are typed and hidden on screenshots, but can’t be hidden in page text the AI reads.',
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
  disconnect: 'Ngắt kết nối',
  disconnecting: 'Đang ngắt…',
  status_connected: 'Đã kết nối',
  status_connecting: 'Đang kết nối',
  status_offline: 'Ngoại tuyến',
  status_replaced: 'Đang dùng ở nơi khác',
  'status_not-allowed': 'Cần mật khẩu',
  'status_signed-out': 'Chưa kết nối',
  paused: 'Đã dừng',
  status_off: 'Tắt',
  localMode: 'Chế độ cục bộ',
  language: 'Ngôn ngữ',
  theme: 'Giao diện',
  theme_light: 'Sáng',
  theme_dark: 'Tối',
  theme_system: 'Theo hệ thống',
  localWaiting: 'Đang chờ server cục bộ',
  localHint: 'Thêm đoạn này vào cấu hình MCP của Claude Desktop, Cursor hoặc client khác:',
  err_offline: 'Mất kết nối mạng.',
  err_revoked: 'Chrome này đã bị ngắt. Kết nối lại nhé.',
  err_replaced: 'Đang kết nối từ một Chrome khác.',
  err_network: 'Không tới được máy chủ.',
  err_wrong_password: 'Sai mật khẩu.',
  err_server: 'Máy chủ từ chối. Thử lại sau.',
  bar_working: 'Agent đang làm việc',
  bar_paused: 'Agent đã dừng',
  prompt_handback: 'Agent cần bạn: {reason}',
  prompt_handback_detail: '{agent} trên {host} đang chờ. Bấm Xong khi bạn làm xong.',
  choice_done: 'Xong',
  choice_cancel: 'Huỷ',
  pending: 'Đang chờ bạn',
  audit: 'Nhật ký kiểm tra',
  audit_title: 'Nhật ký kiểm tra',
  audit_sub: 'Mọi lệnh agent đã gọi, mới nhất ở trên. Chỉ lưu trên máy này.',
  audit_export: 'Xuất JSON',
  audit_clear: 'Xoá hết',
  audit_empty: 'Chưa ghi nhận lệnh nào',
  audit_time: 'Thời gian',
  audit_agent: 'Agent',
  audit_tool: 'Công cụ',
  audit_site: 'Trang',
  audit_result: 'Kết quả',
  audit_approval: 'Trả lời',
  outcome_ok: 'Xong',
  outcome_error: 'Lỗi',
  outcome_blocked: 'Bị chặn',
  outcome_declined: 'Bị từ chối',
  approval_approved: 'Đã đồng ý',
  approval_declined: 'Đã từ chối',
  approval_timeout: 'Hết giờ',
  secrets: 'Bí mật',
  secretsHint: 'Chỉ lưu trong trình duyệt này. AI không thấy giá trị.',
  noSecrets: 'Chưa có bí mật nào',
  secretName: 'Tên, ví dụ GITHUB_PASSWORD',
  secretValue: 'Giá trị',
  secretSave: 'Lưu',
  secretDelete: 'Xóa',
  secretInvalid: 'Nhập tên và giá trị.',
  secretNameAs: 'Sẽ lưu với tên',
  secretShort: 'Giá trị rất ngắn vẫn được tự điền và che trên ảnh chụp, nhưng không che được trong chữ trên trang mà AI đọc.',
};

export type Key = keyof typeof en;
/** A full translation: the compiler flags any key a language is missing. */
export type Strings = Record<Key, string>;
const dict: Record<Lang, Strings> = { en, vi, zh, ja, ko, es, fr, de, pt, ru, id, th };

export interface Prefs {
  lang: Lang;
  theme: Theme;
}

// Extension pages keep preferences in chrome.storage. The gateway's web pages have no extension API, so they
// use localStorage under the keys their pre-paint script reads (see worker/src/pages.ts).
const inExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const WEB_KEY = { lang: 'cma-lang', theme: 'cma-theme' } as const;
const WEB_EVENT = 'helmsman-prefs';

function webGet(key: keyof Prefs): string | undefined {
  try {
    return localStorage.getItem(WEB_KEY[key]) ?? undefined;
  } catch {
    return undefined;
  }
}

async function storedPrefs(): Promise<Partial<Record<keyof Prefs, unknown>>> {
  if (inExtension) return ((await chrome.storage.local.get('prefs')).prefs ?? {}) as Partial<Prefs>;
  return { lang: webGet('lang'), theme: webGet('theme') };
}

export async function getPrefs(): Promise<Prefs> {
  const p = await storedPrefs();
  const lang = isLang(p.lang) ? p.lang : matchLang(navigator.language);
  const theme = p.theme === 'dark' || p.theme === 'system' ? p.theme : 'light';
  return { lang, theme };
}

export async function setPrefs(next: Partial<Prefs>): Promise<Prefs> {
  const merged = { ...(await getPrefs()), ...next };
  if (inExtension) {
    await chrome.storage.local.set({ prefs: merged });
  } else {
    try {
      localStorage.setItem(WEB_KEY.lang, merged.lang);
      localStorage.setItem(WEB_KEY.theme, merged.theme);
    } catch {
      // Storage blocked: the choice still applies to this page.
    }
    dispatchEvent(new Event(WEB_EVENT));
  }
  return merged;
}

/** Calls `listener` whenever the preferences change (in any extension page, or on this web page). Returns the unsubscribe. */
export function onPrefsChange(listener: () => void): () => void {
  if (inExtension) {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => changes.prefs && listener();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }
  addEventListener(WEB_EVENT, listener);
  return () => removeEventListener(WEB_EVENT, listener);
}

export function t(lang: Lang, key: Key): string {
  return dict[lang][key] ?? en[key];
}

/** t() with {name} placeholders filled in. */
export function tf(lang: Lang, key: Key, params: Record<string, string>): string {
  return t(lang, key).replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}

/** Resolves "system" to the OS setting. */
export function isDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
