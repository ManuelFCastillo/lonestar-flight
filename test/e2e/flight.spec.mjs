// End-to-end: boots the real page in headless Chromium with Cesium, but with the city stream replaced by a test
// hook (window.__lsfFakeTiles) so no ion token and no Google tiles are needed. Flies the jet with the keyboard.
// No wall-clock sleeps: every wait is a condition on page state. Headless Chromium runs Cesium slowly and the
// game clock follows the frame rate, so anything that takes game time is polled, never timed.
import { test as base, expect } from '@playwright/test';

const SLOW = { timeout: 90_000 };   // for conditions that need game time to pass at headless frame rates

const test = base.extend({
  // A page on the start screen, with the city stream stubbed and page errors turned into failures.
  page: async ({ page }, use) => {
    await page.addInitScript(() => { window.__lsfFakeTiles = true; });
    page.on('pageerror', (e) => { throw new Error('page error: ' + e.message + '\n' + (e.stack || '')); });
    await page.goto('/');
    await expect(page.locator('#goText')).toHaveText('Take off');
    await use(page);
  },
  // The jet in the air: Enter, HUD on, speed reading. Plus helpers that read the HUD and hold keys until an effect shows.
  flight: async ({ page }, use) => {
    const hud = (id) => page.locator('#' + id);
    const num = async (id) => Number((await hud(id).textContent()).replace(/[^\d.-]/g, ''));
    const holdUntil = async (key, predicate, opts = SLOW) => {
      await page.keyboard.down(key);
      try { await expect.poll(predicate, opts).toBe(true); } finally { await page.keyboard.up(key); }
    };
    const frames = (n) => page.evaluate((n) => new Promise((r) => { const tick = () => (--n <= 0 ? r() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
    await page.keyboard.press('Enter');
    await expect(hud('hud')).toHaveClass(/on/);
    await expect.poll(() => num('spd')).toBeGreaterThan(100);
    await use({ hud, num, holdUntil, frames });
  },
});

test('start screen: title, two modes, brief follows the mode, token prompt when unconfigured', async ({ page }) => {
  await expect(page).toHaveTitle(/Lone Star Flight/);
  await expect(page.locator('#mTour')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brief')).toContainText('Barton Springs');
  await page.locator('#mFree').click();
  await expect(page.locator('#mFree')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brief')).toContainText('No clock');
  await expect(page.locator('#tokenbox')).toBeVisible();   // this build has no token baked in
});

test('Enter takes off; speed, clock and the first gate come alive', async ({ flight }) => {
  await expect(flight.hud('gName')).toHaveText('Barton Springs');
  await expect(flight.hud('gIdx')).toHaveText('Gate 1 / 8');
  await expect(flight.hud('hdg')).toHaveText('090');          // spawn heads east over Zilker
  const t0 = await flight.hud('clock').textContent();
  await expect.poll(() => flight.hud('clock').textContent(), SLOW).not.toBe(t0);
});

test('W and S run the throttle', async ({ page, flight }) => {
  const width = () => page.locator('#thr').evaluate((el) => parseFloat(el.style.width));
  const start = await width();
  await flight.holdUntil('KeyW', async () => (await width()) > start + 10);
  const raised = await width();
  await flight.holdUntil('KeyS', async () => (await width()) < start);
  expect(raised).toBeGreaterThan(start);
  expect(await width()).toBeLessThan(start);
});

test('banking left turns the jet; R puts it back on 090', async ({ flight }) => {
  await flight.holdUntil('ArrowLeft', async () => Math.abs((await flight.num('hdg')) - 90) > 5);
  await flight.hud('hud').page().keyboard.press('KeyR');
  await expect(flight.hud('hdg')).toHaveText('090');
});

test('P pauses with the controls card, the clock holds across frames, Escape resumes', async ({ page, flight }) => {
  await page.keyboard.press('KeyP');
  await expect(page.locator('#pause')).toHaveClass(/on/);
  const frozen = await flight.hud('clock').textContent();
  await flight.frames(90);                                      // a second and a half of render frames, not wall time
  await expect(flight.hud('clock')).toHaveText(frozen);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).not.toHaveClass(/on/);
  await expect.poll(() => flight.hud('clock').textContent(), SLOW).not.toBe(frozen);
});

test('C swaps chase and cockpit, Space pours smoke, X drops the assist', async ({ page, flight }) => {
  await page.keyboard.press('KeyC');
  await expect(flight.hud('pCam')).toHaveText('Cockpit');
  await page.keyboard.press('Space');
  await expect(flight.hud('pSmoke')).toHaveClass(/on/);
  await expect(flight.hud('pAssist')).toHaveClass(/on/);
  await page.keyboard.press('KeyX');
  await expect(flight.hud('pAssist')).not.toHaveClass(/on/);
  await expect(page.locator('#toast')).toContainText('assist off');
});

test('holding Space switches to red, white and blue; releasing keeps the white toggle', async ({ page, flight }) => {
  await flight.holdUntil('Space', async () => (await flight.hud('pSmoke').textContent()) === 'Red white blue');
  await expect(flight.hud('pSmoke')).toHaveText('Smoke');
  await expect(flight.hud('pSmoke')).not.toHaveClass(/on/);     // a hold is not a tap: the toggle is untouched
});

test('inverted pitch is a checkbox, mirrors the I key, and survives a reload', async ({ page }) => {
  await expect(page.locator('#optInvert')).not.toBeChecked();
  await page.locator('#optInvert').check();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pInv')).toHaveClass(/on/);
  await page.keyboard.press('KeyI');
  await expect(page.locator('#pInv')).not.toHaveClass(/on/);
  await page.keyboard.press('KeyI');
  await expect(page.locator('#pInv')).toHaveClass(/on/);
  await page.reload();
  await expect(page.locator('#optInvert')).toBeChecked();
});

test('inverted pitch flips the arrow keys', async ({ page, flight }) => {
  // Altitude is unavailable without the city, so read the climb rate the page exposes for tests (vertical part of the nose vector).
  const climb = () => page.evaluate(() => window.__lsfClimb);
  await flight.holdUntil('ArrowUp', async () => (await climb()) > 0.05);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyI');
  await expect(flight.hud('pInv')).toHaveClass(/on/);
  await flight.holdUntil('ArrowUp', async () => (await climb()) < -0.05);
});

test('Shift lights the afterburner, pushes past the normal top speed, then booms through Mach 1', async ({ page, flight }) => {
  const width = () => page.locator('#thr').evaluate((el) => parseFloat(el.style.width));
  await flight.holdUntil('KeyW', async () => (await width()) > 99);                       // full throttle
  await expect.poll(() => flight.num('spd'), SLOW).toBeGreaterThan(540);                 // settling toward the 661 kt ceiling
  await page.keyboard.down('Shift');
  try {
    await expect(flight.hud('pBurn')).toHaveClass(/on/);
    await expect.poll(() => flight.num('spd'), SLOW).toBeGreaterThan(680);               // only the burner gets past 661 kt
    await expect.poll(() => page.evaluate(() => window.__lsfBooms || 0), SLOW).toBeGreaterThan(0);
    await expect.poll(() => flight.hud('spdU').textContent(), SLOW).toContain('M 1');
  } finally { await page.keyboard.up('Shift'); }
  await expect(flight.hud('pBurn')).not.toHaveClass(/on/);
});

test('music is on by default, starts with the flight, and the button silences it', async ({ page }) => {
  await expect(page.locator('#bMusic')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => !document.getElementById('music').paused)).toBe(true);
  await page.locator('#bMusic').click();
  await expect(page.locator('#bMusic')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => document.getElementById('music').paused)).toBe(true);
  await page.reload();
  await expect(page.locator('#bMusic')).toHaveAttribute('aria-pressed', 'false');   // remembered
});

test('dusk is the default, L flips to night, and the choice is remembered', async ({ page, flight }) => {
  await expect(page.locator('#bNight')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyL');
  await expect(page.locator('#bNight')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toast')).toContainText('Night');
  await page.reload();
  await expect(page.locator('#bNight')).toHaveAttribute('aria-pressed', 'true');
});

test('the link unfurls: Open Graph title, description and a 1200x630 image', async ({ page }) => {
  const content = (p) => page.locator(`meta[property="${p}"]`).getAttribute('content');
  expect(await content('og:title')).toContain('Austin');
  expect(await content('og:image')).toBe('https://lonestar-flight.vercel.app/og.jpg');
  expect(await content('og:image:width')).toBe('1200');
  const res = await page.request.get('/og.jpg');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/image\/jpeg/);
});

test('T replays the recorded flight from other cameras, then hands the stick back', async ({ page, flight }) => {
  await flight.holdUntil('ArrowLeft', async () => Math.abs((await flight.num('hdg')) - 90) > 5);   // a few seconds of tape with a turn in it
  await page.keyboard.press('KeyT');
  await expect(flight.hud('pCam')).toHaveText(/^(Chase|Replay)$/);   // the pill names the replay camera: Chase for the chase view, Replay for the others
  await expect(page.locator('#toast')).toContainText('Instant replay');
  await expect.poll(() => page.evaluate(() => window.__lsf.replaying)).toBe(true);
  // a second T ends it; the tape is short at headless frame rates, so press only if it has not already run out
  await page.evaluate(() => { if (window.__lsf.replaying) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' })); });
  await expect.poll(() => page.evaluate(() => window.__lsf.replaying)).toBe(false);
  await expect(flight.hud('pCam')).toHaveText('Chase');
});

test('the tour-complete card offers the replay, a rerun and free flight', async ({ page }) => {
  await expect(page.locator('#done #bReplay')).toHaveText(/replay/i);          // attached, shown when the eighth gate is hit
  await expect(page.locator('#done #bAgain')).toHaveText(/again/i);
  await expect(page.locator('#done #bKeep')).toHaveText(/keep flying/i);
});

test('free flight hides the gate panel and the clock', async ({ page }) => {
  await page.locator('#mFree').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#hud')).toHaveClass(/on/);
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#clock')).toBeHidden();
});
