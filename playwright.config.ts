import { defineConfig } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8787';

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.e2e\.ts/,
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: `npx wrangler dev --config worker/wrangler.jsonc --port ${port} --ip 127.0.0.1 --var PUBLIC_URL:http://localhost:${port}`,
    url: `http://localhost:${port}/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
