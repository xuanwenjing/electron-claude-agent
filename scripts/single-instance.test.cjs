const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const ts = require('typescript');

function setup({ primary = true, background = false, login = false, platform = 'win32' } = {}) {
  const calls = [];
  const windows = [];
  let finishReady;
  const ready = new Promise((resolve) => { finishReady = resolve; });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => { calls.push('lock'); return primary; };
  app.quit = () => { calls.push('quit'); app.emit('before-quit'); };
  app.whenReady = () => ready;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.visible = options.show; this.minimized = false; this.focused = false; this.destroyed = false;
      windows.push(this);
    }
    static getAllWindows() { return windows.filter((win) => !win.destroyed); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    removeMenu() {}
    loadFile() {}
    restore() { this.minimized = false; }
    show() { this.visible = true; }
    focus() { this.focused = true; }
  }
  const track = (name) => () => calls.push(name);
  const modules = {
    electron: { app, BrowserWindow: Window },
    'node:path': path,
    './agent/pythonMcp': { killAllPython: track('cleanup-python') },
    './crawl/bridgeServer': { stopBridgeServer: track('cleanup-bridge') },
    './db': { initDatabase: track('database'), closeDatabase: track('cleanup-database') },
    './utils/env': { loadEnvFiles: track('env'), loadUserDataEnv: track('user-env') },
    './ipc': { registerIpcHandlers: track('ipc'), startCrawlBridge: track('bridge') },
    './update': { startUpdaters: track('updater') },
    './window/autoLaunch': {
      applyOpenAtLogin: track('login'),
      launchedAtLogin: (argv = login ? ['client.exe', '--open-at-login'] : ['client.exe']) => argv.includes('--open-at-login'),
    },
    '../update/appUpdater': { consumeLaunchWithoutFocus: () => background },
    './autoLaunch': { launchedAtLogin: () => login },
    './tray': { setupWindowsTray: async () => {} },
  };
  function load(filename) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      exports, __dirname: path.dirname(filename), process: { platform },
      require(name) { assert.ok(name in modules, name); return modules[name]; },
    });
    return exports;
  }
  modules['./window'] = load(process.env.WINDOW_SOURCE || path.join(__dirname, '../src/main/window/index.ts'));
  load(process.env.MAIN_SOURCE || path.join(__dirname, '../src/main/index.ts'));
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { app, calls, windows, flush, ready: async () => { finishReady(); await flush(); } };
}

test('second process exits without initializing services or windows', async () => {
  const context = setup({ primary: false });
  await context.ready();
  assert.deepEqual(context.calls, ['lock', 'quit']);
  assert.equal(context.windows.length, 0);
});

test('relaunch restores and focuses the existing hidden/minimized window', async () => {
  const context = setup({ background: true });
  await context.ready();
  const win = context.windows[0];
  win.minimized = true;
  context.app.emit('second-instance');
  await context.flush();
  assert.equal(context.windows.length, 1);
  assert.equal(win.visible, true);
  assert.equal(win.minimized, false);
  assert.equal(win.focused, true);
  assert.equal(context.calls.filter((call) => call === 'bridge').length, 1);
});

test('relaunch during initial startup waits and shows a single window', async () => {
  const context = setup({ background: true });
  context.app.emit('second-instance');
  context.app.emit('second-instance');
  assert.equal(context.windows.length, 0);
  await context.ready();
  assert.equal(context.windows.length, 1);
  assert.equal(context.windows[0].visible, true);
  assert.equal(context.windows[0].focused, true);
});

test('macOS activation reuses a window and recreates it only after destruction', async () => {
  const context = setup({ platform: 'darwin' });
  await context.ready();
  context.app.emit('activate');
  await context.flush();
  assert.equal(context.windows.length, 1);
  assert.equal(context.windows[0].visible, true);
  context.windows[0].destroyed = true;
  context.windows[0].emit('closed');
  context.app.emit('second-instance');
  await context.flush();
  assert.equal(context.windows.length, 2);
  assert.equal(context.windows[1].visible, true);
});

test('duplicate login startup does not show the tray window', async () => {
  const context = setup({ login: true });
  await context.ready();
  context.app.emit('second-instance', {}, ['client.exe', '--open-at-login']);
  await context.flush();
  assert.equal(context.windows.length, 1);
  assert.equal(context.windows[0].visible, false);
  assert.equal(context.windows[0].focused, false);
  context.app.emit('second-instance', {}, ['client.exe']);
  await context.flush();
  assert.equal(context.windows[0].visible, true);
  assert.equal(context.windows[0].focused, true);
});

test('duplicate login during startup never queues a foreground activation', async () => {
  const context = setup({ login: true });
  context.app.emit('second-instance', {}, ['client.exe', '--open-at-login']);
  await context.ready();
  assert.equal(context.windows.length, 1);
  assert.equal(context.windows[0].visible, false);
});

test('Windows startup activation does not surface a background window', async () => {
  const context = setup({ login: true });
  context.app.emit('activate');
  await context.ready();
  assert.equal(context.windows[0].visible, false);
});
