import { describe, expect, it } from 'vitest';
import { landingPage, privacyPage } from '../worker/src/pages';

describe('privacy policy page', () => {
  const html = privacyPage();

  it('keeps the shared layout: the popup theme and its language and theme popovers', () => {
    expect(html).toContain('<link rel="stylesheet" href="/ui.css">');
    expect(html).toContain('<script src="/ui.js" defer>');
    expect(html).toContain('<div id="prefs">');
    expect(html).toContain('<span data-l="vi">');
    expect(html).toContain('<span data-l="en">');
  });

  it('states what is stored where and how to get in touch', () => {
    expect(html).toContain('chrome.storage.local');
    expect(html).toContain('OAuth grants');
    expect(html).toContain('connection code');
    expect(html).toContain('does not store');
    expect(html).toContain('github.com/BillyND/browser-use-bridge/issues');
  });

  it('explains every manifest permission', () => {
    for (const perm of ['debugger', 'tabs', 'tabGroups', 'scripting', 'storage', 'alarms', 'downloads', 'webNavigation', 'cookies', 'history', '&lt;all_urls&gt;']) {
      expect(html).toContain(perm);
    }
  });

  it('guides each AI client in its own tab, with the cloud URL or the local command', () => {
    const landing = landingPage('https://example.test');
    for (const id of ['chatgpt', 'claude', 'claude-code', 'cursor', 'vscode', 'codex']) expect(landing).toContain(`data-tab="${id}"`);
    expect(landing.match(/role="tabpanel"/g)).toHaveLength(6);
    expect(landing.match(/ hidden>/g)).toHaveLength(5);
    expect(landing).toContain('https://example.test/mcp');
    expect(landing).toContain('claude mcp add helmsman -- npx -y --package=https://example.test/helmsman-mcp.tgz helmsman-mcp');
    expect(landing).toContain('Always allow');
  });

  it('is linked from the landing footer', () => {
    expect(landingPage('https://example.test')).toContain('<a href="/privacy">');
  });
});
