const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const root = process.env.BUILD_TEST_ROOT || path.resolve(__dirname, '..');

test('compiled main process loads the current window module, not a stale window.js', () => {
  const mainRequire = createRequire(path.join(root, 'dist/main/index.js'));
  assert.equal(
    mainRequire.resolve('./window'),
    path.join(root, 'dist/main/window/index.js'),
  );
});
