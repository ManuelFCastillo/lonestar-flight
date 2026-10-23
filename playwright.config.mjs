import { defineConfig } from '@playwright/test';

// GitHub's 2-core runner renders Cesium in software at about one frame a second, and the game clock follows the frame
// rate (dt is capped at 50 ms), so everything that takes game time needs a far bigger budget there than on a laptop.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: CI ? 300_000 : 60_000,
  expect: { timeout: CI ? 30_000 : 10_000 },
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8769',
    headless: true,
    viewport: CI ? { width: 960, height: 600 } : { width: 1280, height: 800 },   // fewer pixels for the software rasterizer; nothing in the game keys off the viewport size
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
