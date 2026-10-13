import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8769',
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node build.mjs && node scripts/serve.mjs 8769',
    url: 'http://127.0.0.1:8769/',
    reuseExistingServer: !process.env.CI,
    env: { CESIUM_ION_TOKEN: '' },   // the suite never streams the city; the page runs on the test hook instead
  },
});
