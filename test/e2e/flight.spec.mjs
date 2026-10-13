// End-to-end: boots the real page in headless Chromium with Cesium, but with the city stream replaced by a test
// hook (window.__lsfFakeTiles) so no ion token and no Google tiles are needed. Flies the jet with the keyboard.
import { test, expect } from '@playwright/test';

const hud = (page, id) => page.locator('#' + id);
const num = async (page, id) => Number((await hud(page, id).textContent()).replace(/[^\d.-]/g, ''));
const hold = async (page, key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__lsfFakeTiles = true; });
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto('/');
  await expect(page.locator('#goText')).toHaveText('Take off');
});

async function takeOff(page) {
  await page.keyboard.press('Enter');
  await expect(page.locator('#hud')).toHaveClass(/on/);
  await expect.poll(() => num(page, 'spd')).toBeGreaterThan(100);
}

test('start screen: title, two modes, brief follows the mode, token prompt when unconfigured', async ({ page }) => {
  await expect(page).toHaveTitle(/Lone Star Flight/);
  await expect(page.locator('#mTour')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brief')).toContainText('Barton Springs');
  await page.locator('#mFree').click();
  await expect(page.locator('#mFree')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brief')).toContainText('No clock');
  await expect(page.locator('#tokenbox')).toBeVisible();   // this build has no token baked in
});

test('Enter takes off; speed, clock and the first gate come alive', async ({ page }) => {
  await takeOff(page);
  await expect(page.locator('#gName')).toHaveText('Barton Springs');
  await expect(page.locator('#gIdx')).toHaveText('Gate 1 / 8');
  await expect(page.locator('#hdg')).toHaveText('090');          // spawn heads east over Zilker
  const t0 = await page.locator('#clock').textContent();
  await page.waitForTimeout(1500);
  expect(await page.locator('#clock').textContent()).not.toBe(t0);
});

test('W and S run the throttle', async ({ page }) => {
  await takeOff(page);
  const width = () => page.locator('#thr').evaluate((el) => parseFloat(el.style.width));
  const start = await width();
  await hold(page, 'KeyW', 700);
  expect(await width()).toBeGreaterThan(start);
  await hold(page, 'KeyS', 1500);
  expect(await width()).toBeLessThan(start);
});

test('rolling left turns the jet; R puts it back', async ({ page }) => {
  await takeOff(page);
  await hold(page, 'ArrowLeft', 500);
  await page.waitForTimeout(1200);
  const h = await num(page, 'hdg');
  expect(h).not.toBe(90);
  await page.keyboard.press('KeyR');
  await expect(page.locator('#hdg')).toHaveText('090');
});

test('P pauses with the controls card and Escape resumes', async ({ page }) => {
  await takeOff(page);
  await page.keyboard.press('KeyP');
  await expect(page.locator('#pause')).toHaveClass(/on/);
  const frozen = await page.locator('#clock').textContent();
  await page.waitForTimeout(1500);
  expect(await page.locator('#clock').textContent()).toBe(frozen);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).not.toHaveClass(/on/);
});

test('C swaps chase and cockpit, Space pours smoke, X drops the assist', async ({ page }) => {
  await takeOff(page);
  await page.keyboard.press('KeyC');
  await expect(page.locator('#pCam')).toHaveText('Cockpit');
  await page.keyboard.press('Space');
  await expect(page.locator('#pSmoke')).toHaveClass(/on/);
  await expect(page.locator('#pAssist')).toHaveClass(/on/);
  await page.keyboard.press('KeyX');
  await expect(page.locator('#pAssist')).not.toHaveClass(/on/);
  await expect(page.locator('#toast')).toContainText('assist off');
});

test('inverted pitch is a checkbox, mirrors the I key, and survives a reload', async ({ page }) => {
  await expect(page.locator('#optInvert')).not.toBeChecked();
  await page.locator('#optInvert').check();
  await takeOff(page);
  await expect(page.locator('#pInv')).toHaveClass(/on/);
  await page.keyboard.press('KeyI');
  await expect(page.locator('#pInv')).not.toHaveClass(/on/);
  await page.keyboard.press('KeyI');
  await page.reload();
  await expect(page.locator('#optInvert')).toBeChecked();
});

test('inverted pitch flips the arrow keys', async ({ page }) => {
  // Altitude is unavailable without the city, so read the climb rate the page exposes for tests (vertical part of the nose vector).
  await takeOff(page);
  await hold(page, 'ArrowUp', 600);
  const normalClimb = await page.evaluate(() => window.__lsfClimb);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyI');
  await expect(page.locator('#pInv')).toHaveClass(/on/);
  await hold(page, 'ArrowUp', 600);
  const invertedClimb = await page.evaluate(() => window.__lsfClimb);
  expect(normalClimb).toBeGreaterThan(0.05);
  expect(invertedClimb).toBeLessThan(-0.05);
});

test('Shift lights the afterburner and pushes past the normal top speed', async ({ page }) => {
  // Headless Chromium renders Cesium slowly and the game clock follows the frame rate, so poll for states instead of sleeping.
  test.setTimeout(180_000);
  await takeOff(page);
  const width = () => page.locator('#thr').evaluate((el) => parseFloat(el.style.width));
  await page.keyboard.down('KeyW');
  await expect.poll(width, { timeout: 20_000 }).toBeGreaterThan(99);                 // full throttle
  await page.keyboard.up('KeyW');
  await expect.poll(() => num(page, 'spd'), { timeout: 60_000 }).toBeGreaterThan(540); // settling toward the 661 kt ceiling
  await page.keyboard.down('Shift');
  await expect(page.locator('#pBurn')).toHaveClass(/on/);
  await expect.poll(() => num(page, 'spd'), { timeout: 60_000 }).toBeGreaterThan(680); // only the burner gets past 661 kt
  // keep holding: stage two, then the sonic boom when the jet crosses the in-game Mach 1
  await expect(page.locator('#toast')).toContainText('Mach 1', { timeout: 90_000 });
  await expect.poll(() => page.locator('#spdU').textContent()).toContain('M 1');
  await page.keyboard.up('Shift');
  await expect(page.locator('#pBurn')).not.toHaveClass(/on/);
});

test('music is on by default, starts with the flight, and the button silences it', async ({ page }) => {
  await expect(page.locator('#bMusic')).toHaveAttribute('aria-pressed', 'true');
  await takeOff(page);
  await expect.poll(() => page.evaluate(() => !document.getElementById('music').paused)).toBe(true);
  await page.locator('#bMusic').click();
  await expect(page.locator('#bMusic')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.getElementById('music').paused)).toBe(true);
  await page.reload();
  await expect(page.locator('#bMusic')).toHaveAttribute('aria-pressed', 'false');   // remembered
});

test('dusk is the default, L flips to night, and the choice is remembered', async ({ page }) => {
  await expect(page.locator('#bNight')).toHaveAttribute('aria-pressed', 'false');
  await takeOff(page);
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

test('free flight hides the gate panel and the clock', async ({ page }) => {
  await page.locator('#mFree').click();
  await takeOff(page);
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#clock')).toBeHidden();
});
