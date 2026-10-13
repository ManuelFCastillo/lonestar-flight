// Captures the Open Graph preview image (src/og.jpg, 1200x630) from the live site: real tiles, in flight, HUD on.
// Usage: node scripts/og-shot.mjs [url]   (needs @playwright/test and its Chromium, same as the e2e suite)
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'https://lonestar-flight.vercel.app/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.addInitScript(() => { try { localStorage.setItem('music', '0'); localStorage.setItem('night', '0'); } catch {} });
await page.goto(url, { waitUntil: 'load' });
await page.locator('#goText').filter({ hasText: 'Take off' }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(8000);                 // let the first tiles land before the camera moves
await page.keyboard.press('Enter');
await page.locator('#hud.on').waitFor();
await page.keyboard.down('Shift');               // plumes on, speed up toward downtown
await page.waitForTimeout(25_000);               // headless runs the sim slowly; this is a few seconds of flight
await page.keyboard.up('Shift');
await page.waitForTimeout(6000);                 // let tiles refine for the frame
await page.screenshot({ path: 'src/og.jpg', type: 'jpeg', quality: 86 });
await browser.close();
console.log('wrote src/og.jpg');
