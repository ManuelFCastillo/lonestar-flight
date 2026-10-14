// Tile-streaming benchmark: boots the live page in headless Chromium, takes off with the afterburner lit, and
// counts how often a tile in the middle of the screen is drawn at a coarser level than it should be ("blurry").
// Each run gets a fresh browser context (cold tile cache), so runs are comparable; the Google CDN stays warm.
//
//   node scripts/perf-tiles.mjs                       # 2 cold runs against the live site
//   node scripts/perf-tiles.mjs --runs 4 --seconds 24 --lookahead alternate   # A/B a look-ahead preload pass
//   node scripts/perf-tiles.mjs --url http://127.0.0.1:8769/
//
// --lookahead off|on|alternate adds an experimental second tileset traversal from a camera 650 m ahead of the jet
// (Cesium3DTilePass.PRELOAD). Measured 2026-10-13: no improvement over the baseline, so it is not in the game.
import { chromium } from '@playwright/test';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'https://lonestar-flight.vercel.app/');
const RUNS = +arg('runs', 2), SECONDS = +arg('seconds', 20), LOOKAHEAD = arg('lookahead', 'off');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function run(i, lookahead) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('music', '0'); } catch {} });
  await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'perf=' + i, { waitUntil: 'load' });
  await page.locator('#goText').filter({ hasText: 'Take off' }).waitFor({ timeout: 90_000 });
  await page.keyboard.press('Enter');
  await page.locator('#hud.on').waitFor();
  const r = await page.evaluate(async ({ lookahead, seconds }) => {
    const T = window.__lsf.tileset, scene = window.__lsf.scene, C = Cesium;
    let laErr = null;
    if (lookahead) {
      const cam = new C.Camera(scene); cam.frustum = scene.camera.frustum.clone();
      const ps = new C.Cesium3DTilePassState({ pass: C.Cesium3DTilePass.PRELOAD });
      scene.preUpdate.addEventListener(() => { try {
        const mc = scene.camera, d = C.Cartesian3.multiplyByScalar(mc.directionWC, 650, new C.Cartesian3());
        cam.setView({ destination: C.Cartesian3.add(mc.positionWC, d, new C.Cartesian3()), orientation: { direction: mc.directionWC, up: mc.upWC } });
        ps.camera = cam; ps.cullingVolume = cam.frustum.computeCullingVolume(cam.positionWC, cam.directionWC, cam.upWC);
        T.updateForPass(scene.frameState, ps);
      } catch (e) { laErr = String(e); } });
    }
    const key = (c, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: c, key: c }));
    key('ShiftLeft', true);
    let frames = 0, blurry = 0, central = 0, pend = 0; const t0 = performance.now();
    const h = () => {
      frames++; pend += T.statistics.numberOfPendingRequests;
      const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
      for (const t of T._selectedTiles) {
        const w = C.SceneTransforms.worldToWindowCoordinates(scene, t.boundingSphere.center); if (!w) continue;
        const x = w.x / W, y = w.y / H; if (x < 0.25 || x > 0.75 || y < 0.25 || y > 0.75) continue;
        central++; if (t._screenSpaceError > T.maximumScreenSpaceError && t.children.length) blurry++;
      }
    };
    scene.postRender.addEventListener(h);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    scene.postRender.removeEventListener(h); key('ShiftLeft', false);
    const s = T.statistics;
    return { lookahead, fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), blurryPerFrame: +(blurry / frames).toFixed(2),
      blurryShare: +(blurry / Math.max(1, central)).toFixed(3), avgPending: +(pend / frames).toFixed(1),
      tilesLoaded: s.numberOfTilesWithContentReady, requests: s.numberOfAttemptedRequests, laErr };
  }, { lookahead, seconds: SECONDS });
  await ctx.close();
  return r;
}

const rows = [];
for (let i = 1; i <= RUNS; i++) {
  const la = LOOKAHEAD === 'on' || (LOOKAHEAD === 'alternate' && i % 2 === 0);
  const r = await run(i, la); rows.push({ run: i, ...r }); console.error(`run ${i} done`);
}
await browser.close();
console.table(rows.map(({ laErr, ...r }) => r));
if (rows.some((r) => r.laErr)) console.error('look-ahead errors:', rows.map((r) => r.laErr));
