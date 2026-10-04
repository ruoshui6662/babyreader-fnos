'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['line']],
  use: {
    baseURL: 'http://127.0.0.1:8099',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Every test starts with fresh storage: mark the phone 点击区域 guide as
    // seen so it does not cover the page (e2e/mobile-page-turn.spec.js shows it).
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://127.0.0.1:8099', localStorage: [{ name: 'zhenshu.tapGuideSeen', value: '1' }] }]
    }
  },
  webServer: {
    command: 'node e2e/start-server.js',
    env: { ZHENSHU_E2E_RUNTIME_ROOT: process.env.ZHENSHU_E2E_RUNTIME_ROOT || '.runtime/e2e-resource-lifecycle' },
    url: 'http://127.0.0.1:8099/app/zhenshu/api/health',
    reuseExistingServer: false,
    timeout: 30000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
