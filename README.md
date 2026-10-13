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

## Controls

Arrows pitch and roll · A/D rudder · W/S throttle · Space smoke · C camera · R reset · P pause · I invert pitch · M sound · F fullscreen
