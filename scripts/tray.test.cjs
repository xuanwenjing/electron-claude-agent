const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the tray lifecycle on any OS; only the native Electron boundary is faked.
async function setup({ platform = 'win32', iconFails = false, startHidden = false } = {}) {
  const app = new EventEmitter();
  const autoUpdater = new EventEmitter();
  const win = new EventEmitter();
  Object.assign(win, {
    visible: !startHidden, minimized: false, destroyed: false, focused: false,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    hide() { this.visible = false; },
    show() { this.visible = true; },
    restore() { this.minimized = false; },
    focus() { this.focused = true; },
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (!event.prevented) { this.destroyed = true; this.emit('closed'); }
    },
  });
  app.getFileIcon = async () => {
    if (iconFails) throw new Error('icon unavailable');
    return { isEmpty: () => false };
  };
  app.quit = () => { app.emit('before-quit'); win.close(); if (win.destroyed) app.emit('will-quit'); };
  const trays = [];
  class Tray extends EventEmitter {
    constructor() { super(); this.destroyed = false; trays.push(this); }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const filename = process.env.TRAY_SOURCE || path.join(__dirname, '../src/main/window/tray.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, process: { platform, execPath: '/app/client.exe' },
    console: { error() {} },
    require(name) {
      assert.equal(name, 'electron');
      return { app, autoUpdater, Tray };
    },
  }, { filename });
  await exports.setupWindowsTray(win, { startHidden });
  return { app, autoUpdater, win, trays };
}

test('Windows close hides the window; a single tray click restores and focuses it', async () => {
  const { win, trays } = await setup();
  win.close();
  assert.equal(win.destroyed, false);
  assert.equal(win.visible, false);
  win.minimized = true;
  trays[0].emit('click');
  assert.equal(win.visible, true);
  assert.equal(win.minimized, false);
  assert.equal(win.focused, true);
  win.close();
  trays[0].emit('double-click');
  assert.equal(win.visible, true);
});

test('tray has no right-click menu', async () => {
  const { trays } = await setup();
  assert.equal(trays.length, 1);
  assert.equal(trays[0].menu, undefined);
});

test('ordinary app quit bypasses close-to-tray', async () => {
  const { app, win, trays } = await setup();
  app.quit();
  assert.equal(win.destroyed, true);
  assert.equal(trays[0].destroyed, true);
});

test('update installation can close windows before app before-quit', async () => {
  const { autoUpdater, win } = await setup();
  autoUpdater.emit('before-quit-for-update');
  win.close();
  assert.equal(win.destroyed, true);
});

test('a failed tray leaves the normal close path available', async () => {
  const { win, trays } = await setup({ iconFails: true });
  win.close();
  assert.equal(win.destroyed, true);
  assert.equal(trays.length, 0);
});

test('macOS retains normal window closing without a tray', async () => {
  const { win, trays } = await setup({ platform: 'darwin' });
  win.close();
  assert.equal(win.destroyed, true);
  assert.equal(trays.length, 0);
});

test('tray startup stays hidden until the user clicks the icon', async () => {
  const { win, trays } = await setup({ startHidden: true });
  assert.equal(win.visible, false);
  assert.equal(win.minimized, false);
  trays[0].emit('click');
  assert.equal(win.visible, true);
  assert.equal(win.focused, true);
});

test('failed tray creation shows an initially hidden window', async () => {
  const { win } = await setup({ startHidden: true, iconFails: true });
  assert.equal(win.visible, true);
  assert.equal(win.destroyed, false);
});
