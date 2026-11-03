const fs = require('node:fs');
const path = require('node:path');

// tsc does not remove outputs when sources are moved or deleted. A leftover
// window.js takes precedence over window/index.js in Node's module resolution.
// Only remove TypeScript build outputs; Vite owns dist/renderer separately.
const dist = path.resolve(__dirname, '../dist');
for (const directory of ['main', 'preload', 'shared']) {
  fs.rmSync(path.join(dist, directory), { recursive: true, force: true });
}
