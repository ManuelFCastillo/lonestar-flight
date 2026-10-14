// Records the social video. Headed Chromium (real GPU, real tiles), 1080p. The game's autopilot flies the landmark tour
// as a player sees it (chase camera, HUD, gates, toasts): Barton Springs, a low red-white-blue bat run under the Congress
// Avenue bridge, the Capitol, the UT Tower, then afterburner through Mach 1 and Mach 2 out to Mount Bonnell and a smoke
// roll through the Pennybacker Bridge gate. The game then replays the same flight and three short cut-aways are taken from
// other cameras (ground camera at the bridge, orbit at Mach 2, abeam at Pennybacker). ffmpeg assembles the cut and lays the
// soundtrack under it from its loud section.
//   node scripts/promo-video.mjs [--url U] [--music-at SECONDS]     → promo/lonestar-flight.mp4
// Timings are wall-clock: the headed browser runs real time, and the replay runs at the same rate as the flight.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'https://lonestar-flight.vercel.app/'), MUSIC_AT = +arg('music-at', 222);
const W = 1920, H = 1080, LEAD = 2.0;
rmSync('promo/raw', { recursive: true, force: true }); mkdirSync('promo/raw', { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: 'promo/raw', size: { width: W, height: H } } });
const t0 = Date.now(), clock = () => (Date.now() - t0) / 1000;
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('music', '0'); localStorage.setItem('night', '0'); localStorage.setItem('assist', '1'); localStorage.setItem('invert', '0'); } catch {} });
await page.goto(url, { waitUntil: 'load' });
await page.locator('#goText').filter({ hasText: 'Take off' }).waitFor({ timeout: 90_000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gateIs = (n) => page.waitForFunction((n) => window.__lsf.gate >= n, n, { timeout: 120_000 });
const gateDist = () => page.evaluate(() => { const t = document.getElementById('gDist').textContent; const v = parseFloat(t); return /km/.test(t) ? v * 1000 : v; });
await sleep(4000);                                                   // the skyline refines behind the start screen
const tEnter = clock();
await page.keyboard.press('Enter');
await page.locator('#hud.on').waitFor();
await page.evaluate(() => { window.__lsf.autopilot = true; });
const tFlight = clock(), at = () => clock() - tFlight, marks = {};
await gateIs(1);                                                     // Barton Springs: smoke on for the bat run
await page.keyboard.down('Space');
await gateIs(2); marks.bridge = at();                                // under the Congress Avenue bridge, victory roll in red, white and blue
await gateIs(3); marks.capitol = at();
await page.keyboard.up('Space');
await gateIs(4); marks.ut = at();                                    // UT Tower: full throttle and burner out to Mount Bonnell
await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
await page.keyboard.down('Shift');
await page.locator('#spdU').filter({ hasText: 'M 1' }).waitFor({ timeout: 40_000 }); marks.mach1 = at();
await page.waitForFunction(() => parseFloat(document.getElementById('spd').textContent) > 1300, null, { timeout: 45_000 }); marks.mach2 = at();
await page.waitForFunction(() => { const t = document.getElementById('gDist').textContent; const v = parseFloat(t); return (/km/.test(t) ? v * 1000 : v) < 2200; }, null, { timeout: 60_000 });
await page.keyboard.up('Shift'); await page.keyboard.down('KeyS'); await sleep(2000); await page.keyboard.up('KeyS');
await gateIs(5); marks.bonnell = at();                               // Mount Bonnell, then smoke for the Pennybacker gate
await page.keyboard.down('Space');
await gateIs(6); marks.penny = at();
await sleep(3500);
await page.keyboard.up('Space');
await sleep(1500);
const flightLen = at();
// the same flight again, from the other cameras, for the cut-aways
const cuts = [[marks.bridge - 3.5, marks.bridge + 1.5, 'ground'], [marks.mach2 + 0.3, marks.mach2 + 5.3, 'orbit'], [marks.penny - 2.5, marks.penny + 2.5, 'side']];
await page.addStyleTag({ content: '#toast{display:none!important}' });
const tReplay = clock();
if (!await page.evaluate(() => window.__lsf.startReplay(null, { cams: ['chase'], per: 1e9 }))) throw new Error('nothing recorded to replay');
for (const [a, b, cam] of cuts) {
  await sleep(Math.max(0, (tReplay + a - 0.2) - clock()) * 1000); await page.evaluate((c) => window.__lsf.setReplayCam(c), cam);
  await sleep(Math.max(0, (tReplay + b) - clock()) * 1000); await page.evaluate(() => window.__lsf.setReplayCam('chase'));
}
await sleep(Math.max(0, (tReplay + flightLen) - clock()) * 1000);
await page.waitForFunction(() => !window.__lsf.replaying, null, { timeout: 30_000 });
await ctx.close();
const raw = await page.video().path();
await browser.close();
// assemble: live gameplay with the cut-aways spliced in at the same flight time
const segs = []; let cur = -LEAD;                                     // flight-relative seconds; negative covers the start screen
for (const [a, b] of cuts) { segs.push([tFlight + cur, tFlight + a, 'live']); segs.push([tReplay + a, tReplay + b, 'replay']); cur = b; }
segs.push([tFlight + cur, tFlight + flightLen, 'live']);
const dur = segs.reduce((n, [a, b]) => n + (b - a), 0);
const filter = segs.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`).join(';') + ';' + segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0,fade=t=in:d=0.6,fade=t=out:st=${Math.max(0, dur - 1).toFixed(2)}:d=1[v]`;
const out = 'promo/lonestar-flight.mp4';
execFileSync('ffmpeg', ['-y', '-i', raw, '-ss', String(MUSIC_AT), '-i', 'src/austin-afterburner.m4a', '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5`,
  '-c:a', 'aac', '-b:a', '160k', '-t', dur.toFixed(2), '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`wrote ${out} (${dur.toFixed(1)} s; marks ${JSON.stringify(marks)})`);
