// Copies src/ to dist/ and injects the Cesium ion token from CESIUM_ION_TOKEN.
// The token is a client-side credential by design (scope it to the Google 3D Tiles asset in ion).
import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const token = process.env.CESIUM_ION_TOKEN || '';
mkdirSync('dist', { recursive: true });
for (const f of readdirSync('src')) {
  if (f === 'index.html') {
    const html = readFileSync(join('src', f), 'utf8').replace('__CESIUM_ION_TOKEN__', token);
    writeFileSync(join('dist', f), html);
  } else copyFileSync(join('src', f), join('dist', f));
}
console.log(token ? 'built dist/ with ion token' : 'built dist/ WITHOUT ion token (set CESIUM_ION_TOKEN)');
