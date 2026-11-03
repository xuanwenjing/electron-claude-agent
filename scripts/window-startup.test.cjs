const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function setup({ updated = false, login = false } = {}) {
  let trayOptions;
  const timers = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.visible = options.show; this.minimized = false; }
    removeMenu() {}
    loadFile() {}
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    minimize() { this.minimized = true; }
    showInactive() { this.visible = true; }
  }
  const filename = process.env.WINDOW_SOURCE || path.join(__dirname, '../src/main/window/index.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, __dirname: path.dirname(filename), process: { platform: 'win32' },
    setTimeout: (fn) => timers.push(fn),
    require(name) {
      if (name === 'electron') return { BrowserWindow: Window };
      if (name === 'node:path') return path;
      if (name === '../update/appUpdater') return { consumeLaunchWithoutFocus: () => updated };
      if (name === './autoLaunch') return { launchedAtLogin: () => login };
      if (name === './tray') return { setupWindowsTray: async (_win, options) => { trayOptions = options; } };
      throw new Error(name);
    },
  });
  exports.createMainWindow();
  const win = exports.getMainWindow();
  win.emit('ready-to-show');
  for (const timer of timers) timer();
  return { win, trayOptions };
}

test('update restart remains hidden and requests tray startup without minimizing', () => {
  const { win, trayOptions } = setup({ updated: true });
  assert.equal(win.visible, false);
  assert.equal(win.minimized, false);
  assert.equal(trayOptions.startHidden, true);
});

test('ordinary launch shows the main window', () => {
  const { win } = setup();
  assert.equal(win.visible, true);
  assert.equal(win.minimized, false);
});

test('login startup remains hidden in the tray without minimizing', () => {
  const { win, trayOptions } = setup({ login: true });
  assert.equal(win.visible, false);
  assert.equal(win.minimized, false);
  assert.equal(trayOptions.startHidden, true);
});
