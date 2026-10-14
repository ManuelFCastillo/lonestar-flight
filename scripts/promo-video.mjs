// Records a flythrough for social posts. Headed Chromium (real GPU, real tiles), 1080p. The flight is flown once by script
// while the game records it, then played back through the game's instant replay with a camera schedule: a ground camera
// for the smoke pass, abeam for the roll, chase through Mach 1, an orbit for the Mach 2 turn, abeam again for the finale.
// ffmpeg keeps only the replay, muxes the soundtrack from the loud part of the song and fades both ends.
//   node scripts/promo-video.mjs [--url U] [--music-at SECONDS] [--live]     → promo/lonestar-flight.mp4
// --live records the flight as flown from the chase camera instead of the replay. Timings are wall-clock: the headed browser runs real time.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'https://lonestar-flight.vercel.app/'), MUSIC_AT = +arg('music-at', 284), LIVE = process.argv.includes('--live');
const W = 1920, H = 1080, LEAD = LIVE ? 2.5 : 0.6;
rmSync('promo/raw', { recursive: true, force: true }); mkdirSync('promo/raw', { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: 'promo/raw', size: { width: W, height: H } } });
const t0 = Date.now(), clock = () => (Date.now() - t0) / 1000;
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('music', '0'); localStorage.setItem('night', '0'); localStorage.setItem('assist', '1'); } catch {} });
await page.goto(url, { waitUntil: 'load' });
await page.locator('#goText').filter({ hasText: 'Take off' }).waitFor({ timeout: 90_000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = async (key, ms) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };
await sleep(4000);                                                   // let the skyline refine behind the start screen
const tEnter = clock();
await page.keyboard.press('Enter');
await page.locator('#hud.on').waitFor();
const tFlight = clock(), marks = {};                                  // event times relative to the flight start, for the camera schedule
await sleep(1500);
// red, white and blue over the lake, with a full roll; throttle comes up underneath it
await page.keyboard.down('Space'); await page.keyboard.down('KeyW');
await sleep(1200);
marks.roll = clock() - tFlight;
await hold('KeyQ', 1500);
await sleep(800);
marks.weave = clock() - tFlight;
await hold('ArrowLeft', 700); await hold('ArrowRight', 700);
await sleep(1200);
await page.keyboard.up('KeyW'); await page.keyboard.up('Space');
await sleep(400);
// burner: through the barrier over downtown, then a wide left turn at Mach 2 with the city below
marks.burner = clock() - tFlight;
await page.keyboard.down('Shift');
await page.locator('#spdU').filter({ hasText: 'M 1' }).waitFor({ timeout: 30_000 });
marks.mach1 = clock() - tFlight;
await sleep(1500);
await page.keyboard.down('ArrowLeft');
marks.turn = clock() - tFlight;
await page.waitForFunction(() => parseFloat(document.getElementById('spd').textContent) > 1300, null, { timeout: 45_000 });   // 680 m/s ≈ 1322 kt, Mach 2
await sleep(3000);
await page.keyboard.up('ArrowLeft');
await sleep(1500);
await page.keyboard.up('Shift');
// finale: smoke and a victory roll
marks.finale = clock() - tFlight;
await page.keyboard.down('Space');
await sleep(500);
await hold('KeyE', 1800);
await sleep(1800);
await page.keyboard.up('Space');
await sleep(1500);
const flightLen = clock() - tFlight;
let cutStart = tEnter - LEAD, cutEnd = clock();
if (!LIVE) {
  // play the tape back with the camera schedule; the replay runs in real time, so the marks line up with wall-clock sleeps
  const schedule = [[0, 'ground'], [marks.roll - 0.3, 'side'], [marks.weave + 0.6, 'ground'], [marks.burner - 0.2, 'chase'], [marks.turn + 0.8, 'orbit'], [marks.finale, 'side']];
  await page.addStyleTag({ content: '#toast{display:none!important}' });
  const tReplay = clock();
  const ok = await page.evaluate(() => window.__lsf.startReplay(null, { per: 1e9 }));
  if (!ok) throw new Error('nothing recorded to replay');
  for (const [at, cam] of schedule) { await sleep(Math.max(0, (tReplay + at) - clock()) * 1000); await page.evaluate((c) => window.__lsf.setReplayCam(c), cam); }
  await sleep(Math.max(0, (tReplay + flightLen) - clock()) * 1000);
  await page.waitForFunction(() => !window.__lsf.replaying, null, { timeout: 20_000 });
  cutStart = tReplay - LEAD; cutEnd = clock() - 0.3;
}
await ctx.close();
const raw = await page.video().path();
await browser.close();
const out = 'promo/lonestar-flight.mp4', dur = cutEnd - cutStart;
// H.264 + the soundtrack from MUSIC_AT, fades at both ends; yuv420p so LinkedIn and iPhones play it
execFileSync('ffmpeg', ['-y', '-ss', cutStart.toFixed(2), '-t', dur.toFixed(2), '-i', raw, '-ss', String(MUSIC_AT), '-i', 'src/austin-afterburner.m4a', '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30',
  '-vf', `fade=t=in:d=0.6,fade=t=out:st=${Math.max(0, dur - 1).toFixed(2)}:d=1`, '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5`,
  '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`wrote ${out} (${dur.toFixed(1)} s, ${LIVE ? 'live chase' : 'replay'}; marks ${JSON.stringify(marks)})`);
