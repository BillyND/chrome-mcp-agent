import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.e2e\.ts/,
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'npx wrangler dev --config worker/wrangler.jsonc --port 8787 --ip 127.0.0.1',
    url: 'http://localhost:8787/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
