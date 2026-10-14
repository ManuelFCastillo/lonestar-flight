// Records a flythrough for social posts: headed Chromium (real GPU, real tiles), 1080p, then ffmpeg trims the city streaming
// wait and muxes the soundtrack.   Usage: node scripts/promo-video.mjs [url]   → promo/lonestar-flight.mp4
// Sequence: take off over Zilker, red-white-blue smoke with a roll over Lady Bird Lake, full throttle and afterburner through
// Mach 1 over downtown, a wide banked turn at Mach 2 so the city stays in frame, then a victory roll with smoke.
// Timings are wall-clock: the headed browser runs real time.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const url = process.argv[2] || 'https://lonestar-flight.vercel.app/';
const W = 1920, H = 1080, LEAD = 2.5;   // seconds of start screen kept before Take off
rmSync('promo/raw', { recursive: true, force: true }); mkdirSync('promo/raw', { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: 'promo/raw', size: { width: W, height: H } } });
const t0 = Date.now();
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('music', '0'); localStorage.setItem('night', '0'); localStorage.setItem('assist', '1'); } catch {} });
await page.goto(url, { waitUntil: 'load' });
await page.locator('#goText').filter({ hasText: 'Take off' }).waitFor({ timeout: 90_000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = async (key, ms) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };
await sleep(4000);                                                   // let the skyline refine behind the start screen
const tEnter = (Date.now() - t0) / 1000;
await page.keyboard.press('Enter');
await page.locator('#hud.on').waitFor();
await sleep(1500);
// red, white and blue over the lake, with a full roll; throttle comes up underneath it
await page.keyboard.down('Space');
await page.keyboard.down('KeyW');
await sleep(1200);
await hold('KeyQ', 1500);
await sleep(800);
await hold('ArrowLeft', 700); await hold('ArrowRight', 700);
await sleep(1200);
await page.keyboard.up('KeyW');
await page.keyboard.up('Space');
await sleep(400);
// burner: through the barrier over downtown, then a wide left turn at Mach 2 with the city below
await page.keyboard.down('Shift');
await page.locator('#spdU').filter({ hasText: 'M 1' }).waitFor({ timeout: 30_000 });
await sleep(1500);
await page.keyboard.down('ArrowLeft');
await page.waitForFunction(() => parseFloat(document.getElementById('spd').textContent) > 1300, null, { timeout: 45_000 });   // 680 m/s ≈ 1322 kt, Mach 2
await sleep(3000);
await page.keyboard.up('ArrowLeft');
await sleep(1500);
await page.keyboard.up('Shift');
// finale: smoke and a victory roll
await page.keyboard.down('Space');
await sleep(500);
await hold('KeyE', 1800);
await sleep(1800);
await page.keyboard.up('Space');
await sleep(1500);
await ctx.close();
const raw = await page.video().path();
await browser.close();
const out = 'promo/lonestar-flight.mp4';
const start = Math.max(0, tEnter - LEAD);
const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw])) - start;
// H.264 + the soundtrack from the trim point, fades at both ends; yuv420p so LinkedIn and iPhones play it
execFileSync('ffmpeg', ['-y', '-ss', start.toFixed(2), '-i', raw, '-i', 'src/austin-afterburner.m4a', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30',
  '-vf', `fade=t=in:d=0.6,fade=t=out:st=${Math.max(0, dur - 1).toFixed(2)}:d=1`, '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5`,
  '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`wrote ${out} (${dur.toFixed(1)} s, trimmed ${start.toFixed(1)} s of streaming wait)`);
