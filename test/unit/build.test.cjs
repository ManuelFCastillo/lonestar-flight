const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const build = (env) => execFileSync(process.execPath, ['build.mjs'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });

test('build injects the ion token from the environment', () => {
  const out = build({ CESIUM_ION_TOKEN: 'test-token-123' });
  assert.match(out, /with ion token/);
  const html = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(html.includes("let TOKEN='test-token-123'"));
  assert.ok(!html.includes('__CESIUM_ION_TOKEN__'));
});

test('build without a token leaves the page asking for one', () => {
  const out = build({ CESIUM_ION_TOKEN: '' });
  assert.match(out, /WITHOUT ion token/);
  const html = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(html.includes("let TOKEN=''"));
});

test('build copies the game core next to the page', () => {
  build({ CESIUM_ION_TOKEN: '' });
  assert.ok(existsSync(path.join(root, 'dist/game-core.js')));
  const html = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(html.includes('<script src="game-core.js"></script>'));
});
