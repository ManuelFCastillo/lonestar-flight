# Lone Star Flight

Fly a Texas Air National Guard F-16 over the real Austin, streamed as Google Photorealistic 3D Tiles through CesiumJS and Cesium ion.

## Run it

1. Create a free Cesium ion account at https://ion.cesium.com and copy an access token (Access Tokens → the default token is fine, or make one scoped to `assets:read`).
2. Build with the token in the environment and serve `dist/`:

```bash
CESIUM_ION_TOKEN=your_token npm run dev
```

Open http://localhost:8768. Without a token the page asks for one and keeps it in your browser's localStorage.

## Deploy

Vercel runs `node build.mjs`. Add `CESIUM_ION_TOKEN` under Project → Settings → Environment Variables, then redeploy.

The free ion Community plan includes 1,000 Google 3D Tiles root tile requests per month (about one per game start) for personal use.

## Tests

```bash
npm install
npx playwright install chromium
npm test
```

- `npm run test:unit` runs the Node test runner against `src/game-core.js`, the dependency-free module that holds the flight math, HUD formatting, the pilot-assist decision table and the maneuver timelines, plus a check that `build.mjs` injects the token.
- `npm run test:e2e` runs Playwright against the built page in headless Chromium. It boots the real Cesium viewer but swaps the city stream for a test hook (`window.__lsfFakeTiles`), so it needs no token and no Google tiles, then flies the jet with the keyboard: takeoff, throttle, roll, reset, pause, camera, smoke, assist, inverted pitch persistence, free-flight HUD, and a supersonic run with the assist off that samples the ground probe every frame to prove it never reads the jet's own exhaust (the Mach 2 phantom crash of October 2026).

GitHub Actions runs both on every push and pull request (`.github/workflows/test.yml`).

### Tile-streaming benchmark

`node scripts/perf-tiles.mjs` boots the live site in headless Chromium, takes off with the afterburner lit and counts, per frame, how many tiles in the middle of the screen are drawn coarser than their target ("blurry"), along with frame rate and pending requests. Each run uses a fresh browser context, so the tile cache is cold and runs compare fairly. It is how the cache-size and request settings in `loadCity()` were chosen: at a 1 GB cache the tileset evicted and re-fetched tiles constantly (380 evictions in 16 s, 23 fps) where 3 GB had none (33 fps), so desktops with 8 GB or more get 2.5 GB.

`--lookahead alternate` A/B-tests an experimental second tileset traversal from a camera 650 m ahead of the jet (`Cesium3DTilePass.PRELOAD`). On a cold cache it did not reduce blurry frames (10.2 vs 10.4 per frame on the first pair, 2.3 vs 6.9 on the second), so it is not in the game. Headless Chromium renders in software, so the absolute numbers are far below what a GPU sees; only the A/B comparison is meaningful.

## Controls

Arrows pitch, and bank into a turn (hold to tighten, release to level, 65° max) · Q/E full roll · A/D rudder · W/S throttle · Shift afterburner, hold for Mach 1 and Mach 2 · Space smoke · C camera · X pilot assist · R reset · P pause · I invert pitch · N music · L night / dusk · M sound · F fullscreen

## On a phone

Turn the phone sideways, tap Take off and allow motion access. Tilt to bank and pull (Recenter resets the level), a slider for throttle, buttons for burner, smoke, assist, camera and pause. If motion access is refused, drag on the left half of the screen as a stick. Phones get a smaller tile cache and a coarser detail target.

## Instant replay

The game keeps the last three minutes of flight, one entry per frame: position, attitude, speed, throttle, smoke, burner and the sonic booms. T plays it back through the same effects code, cut like a broadcast: a director reads the tape and gives each moment its own shot, a slowed long-lens camera at every gate, an orbit through every sonic boom, a ground camera when the smoke comes on, an abeam shot when the burner lights, the chase view between them, and a fast-forwarded wide shot over long quiet legs; scripts can also park a camera just past the current gate (`gate`). T again, or R, hands the stick back where you left it. The tour-complete card has a Watch the replay button that plays the whole run and brings the card back when it ends. `window.__lsf.startReplay(frames, {cams, per})` and `setReplayCam(name)` drive it from scripts; `scripts/promo-video.mjs` uses that to record the social video from several angles.

## Night, music, afterburner

- **Night** is the default. Google's tiles are daytime photos, so night is a full-screen post-process: the city is darkened and cooled, bright surfaces read as lit windows, and the violet crown sits on the horizon with a purple haze on distant buildings. The moon button or L switches to dusk.
- **Music**: `src/austin-afterburner.m4a` ("Austin Afterburner", AAC) loops from takeoff. The note button or N toggles it; the choice is remembered.
- **Afterburner**: hold Shift for 110 m/s more thrust and a 450 m/s ceiling, with plumes behind the nozzles.

## Credits

The airframe is "F-16 Fighting Falcon - Fighter Jet - Free" (https://skfb.ly/oOR6O) by bohmerang, licensed under CC Attribution-NonCommercial-ShareAlike 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/). The copy in `src/jet/` has its textures reduced from 4096 to 2048 pixels and saved as JPEG, so the model is 4 MB instead of 23 MB; `src/jet/license.txt` is the original notice. City data is Google Photorealistic 3D Tiles served through Cesium ion.
