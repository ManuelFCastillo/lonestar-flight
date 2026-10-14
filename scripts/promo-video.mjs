// Records the social video. Headed Chromium (real GPU, real tiles), 1080p. The game's autopilot flies the landmark tour
// as a player sees it (chase camera, HUD, gates, toasts): Barton Springs, a low red-white-blue bat run under the Congress
// Avenue bridge, the Capitol, the UT Tower, then afterburner through Mach 1 and Mach 2 out to a smoke-on victory roll
// through the Mount Bonnell gate. The game then replays the same flight and three short cut-aways are taken from other
// cameras (a camera on the bridge as the jet comes through the bats, orbit at Mach 2, abeam for the roll); the quiet middle of the hill-country approach
// is jump-cut. ffmpeg assembles the cut and lays the soundtrack under it from its loud section.
//   node scripts/promo-video.mjs [--url U] [--music-at SECONDS]     → promo/lonestar-flight-<date>.mp4, copied to promo/lonestar-flight.mp4
// Record on a fast connection: the city streams while the jet flies, and a slow link leaves the buildings blurry on camera.
// Timings are wall-clock: the headed browser runs real time, and the replay runs at the same rate as the flight.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';

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
const gateIs = async (n) => { try { await page.waitForFunction((n) => window.__lsf.gate >= n, n, { timeout: 120_000 }); } catch (e) { await page.screenshot({ path: 'promo/raw/fail.png' }); throw new Error(`gate ${n} not reached in 120 s (see promo/raw/fail.png): ` + await page.evaluate(() => document.getElementById('gate').textContent.replace(/\s+/g, ' ') + ' spd ' + document.getElementById('spd').textContent + ' alt ' + document.getElementById('alt').textContent)); } console.error(`gate ${n} at ${((Date.now() - t0) / 1000).toFixed(1)} s`); };
const gateDist = () => page.evaluate(() => { const t = document.getElementById('gDist').textContent; const v = parseFloat(t); return /km/.test(t) ? v * 1000 : v; });
// the skyline refines behind the start screen; take off only once the city has really streamed in, or the ground probe reads coarse root tiles
await page.waitForFunction(() => { const t = window.__lsf.tileset; return t && t.statistics.numberOfTilesWithContentReady > 400 && t.statistics.numberOfPendingRequests < 10; }, null, { timeout: 240_000 }).catch(() => console.error('WARNING: city still streaming after 4 min; this connection is slow and the recording will look blurry'));
await sleep(2500);
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
await page.waitForFunction(() => { const t = document.getElementById('gDist').textContent; const v = parseFloat(t); return (/km/.test(t) ? v * 1000 : v) < 900; }, null, { timeout: 60_000 });
await page.keyboard.down('Space');                                   // smoke on for the Mount Bonnell gate and the victory roll behind it
await gateIs(5); marks.bonnell = at();
await sleep(4500);
await page.keyboard.up('Space');
await sleep(1200);
const flightLen = at();
// the same flight again, from the other cameras, for the cut-aways
const cuts = [[marks.bridge - 3.2, marks.bridge + 2.2, 'gate'], [marks.mach2 + 0.3, marks.mach2 + 5.3, 'orbit'], [marks.bonnell - 1.2, marks.bonnell + 3.8, 'side']];
const skips = marks.bonnell - 7 - (marks.mach2 + 6.5) > 3 ? [[marks.mach2 + 6.5, marks.bonnell - 7]] : [];   // jump-cut the long straight run over the hills
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
const events = [...cuts.map(([a, b]) => [a, b, 'replay']), ...skips.map(([a, b]) => [a, b, 'skip'])].sort((x, y) => x[0] - y[0]);
const segs = []; let cur = -LEAD;                                     // flight-relative seconds; negative covers the start screen
for (const [a, b, kind] of events) { if (a > cur) segs.push([tFlight + cur, tFlight + a, 'live']); if (kind === 'replay') segs.push([tReplay + a, tReplay + b, 'replay']); cur = Math.max(cur, b); }
segs.push([tFlight + cur, tFlight + flightLen, 'live']);
const dur = segs.reduce((n, [a, b]) => n + (b - a), 0);
const filter = segs.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`).join(';') + ';' + segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0,fade=t=in:d=0.6,fade=t=out:st=${Math.max(0, dur - 1).toFixed(2)}:d=1[v]`;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const out = `promo/lonestar-flight-${stamp}.mp4`;   // every take is kept; the newest is also copied to promo/lonestar-flight.mp4
execFileSync('ffmpeg', ['-y', '-i', raw, '-ss', String(MUSIC_AT), '-i', 'src/austin-afterburner.m4a', '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5`,
  '-c:a', 'aac', '-b:a', '160k', '-t', dur.toFixed(2), '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'inherit'] });
copyFileSync(out, 'promo/lonestar-flight.mp4');
console.log(`wrote ${out} (${dur.toFixed(1)} s; marks ${JSON.stringify(marks)})`);
