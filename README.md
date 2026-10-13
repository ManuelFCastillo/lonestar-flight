# Lone Star Flight

Keyboard flight game over the real Austin, streamed as Google Photorealistic 3D Tiles through CesiumJS and Cesium ion.

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
- `npm run test:e2e` runs Playwright against the built page in headless Chromium. It boots the real Cesium viewer but swaps the city stream for a test hook (`window.__lsfFakeTiles`), so it needs no token and no Google tiles, then flies the jet with the keyboard: takeoff, throttle, roll, reset, pause, camera, smoke, assist, inverted pitch persistence, free-flight HUD.

GitHub Actions runs both on every push and pull request (`.github/workflows/test.yml`).

## Controls

Arrows pitch and roll · A/D rudder · W/S throttle · Shift afterburner · Space smoke · C camera · X pilot assist · R reset · P pause · I invert pitch · N music · L night / dusk · M sound · F fullscreen

## Night, music, afterburner

- **Night** is the default. Google's tiles are daytime photos, so night is a full-screen post-process: the city is darkened and cooled, bright surfaces read as lit windows, and the violet crown sits on the horizon with a purple haze on distant buildings. The moon button or L switches to dusk.
- **Music**: `src/austin-afterburner.m4a` ("Austin Afterburner", AAC) loops from takeoff. The note button or N toggles it; the choice is remembered.
- **Afterburner**: hold Shift for 110 m/s more thrust and a 450 m/s ceiling, with plumes behind the nozzles.
