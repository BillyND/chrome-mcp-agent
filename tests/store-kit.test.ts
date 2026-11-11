import { describe, expect, it } from 'vitest';
import { landingPage, privacyPage } from '../worker/src/pages';

describe('privacy policy page', () => {
  const html = privacyPage();

  it('keeps the shared layout with language and theme toggles', () => {
    expect(html).toContain('data-lang="en"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('<span data-l="vi">');
    expect(html).toContain('<span data-l="en">');
  });

  it('states what is stored where and how to get in touch', () => {
    expect(html).toContain('chrome.storage.local');
    expect(html).toContain('OAuth grants');
    expect(html).toContain('connection code');
    expect(html).toContain('does not store');
    expect(html).toContain('github.com/BillyND/chrome-mcp-agent/issues');
  });

  it('explains every manifest permission', () => {
    for (const perm of ['debugger', 'tabs', 'tabGroups', 'scripting', 'storage', 'alarms', 'downloads', 'webNavigation', 'cookies', 'history', '&lt;all_urls&gt;']) {
      expect(html).toContain(perm);
    }
  });

  it('is linked from the landing footer', () => {
    expect(landingPage('https://example.test')).toContain('<footer><a href="/privacy">');
  });
});
