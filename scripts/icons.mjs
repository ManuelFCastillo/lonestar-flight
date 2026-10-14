// Renders the app icons (src/icon-180.png, icon-192.png, icon-512.png) from the brand star with headless Chromium.
// Usage: node scripts/icons.mjs   (needs @playwright/test and its Chromium, same as the e2e suite)
import { chromium } from '@playwright/test';

const html = (size) => `<!doctype html><html><body style="margin:0;background:#121a2b">
<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:radial-gradient(circle at 50% 42%,#1d2a46,#121a2b 70%)">
<svg viewBox="0 0 32 32" width="${size * 0.62}" height="${size * 0.62}" fill="none" stroke="#f2c230" stroke-width="2.2" stroke-linejoin="round"><path d="M16 3l3 10 10 1-8 6 3 10-8-6-8 6 3-10-8-6 10-1z" fill="#f2c230" fill-opacity=".18"/></svg>
</div></body></html>`;

const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size));
  await page.screenshot({ path: `src/icon-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('wrote src/icon-180.png, icon-192.png, icon-512.png');
