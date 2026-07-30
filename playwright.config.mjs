import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /site\.spec\.mjs/,
  // Leave headroom for occasional Windows/Chromium local-asset startup stalls.
  // Element assertions retain their tighter timeout below.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'node tests/static-server.mjs 4173 dist',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false
  }
});

