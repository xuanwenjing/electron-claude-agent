const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const root = process.env.UPDATE_REPO || path.resolve(__dirname, '..');
const fromRepo = createRequire(path.join(root, 'package.json'));
const ts = fromRepo('typescript');
const electronId = fromRepo.resolve('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-cache-'));
// Keep the real updater/download helper; replace only Electron's desktop app boundary.
const app = {getVersion:()=> '1.0.0',getName:()=> 'electron-claude-agent',getPath:()=>userData,isPackaged:true};
require.cache[electronId] = {id:electronId,filename:electronId,loaded:true,exports:{app,autoUpdater:new (require("node:events").EventEmitter)()}};
const sourceFile = process.env.UPDATER_SOURCE || path.join(root, 'src/main/update/updater.ts');
function load(platform) {
  const exports = {};
  if (!fs.existsSync(sourceFile)) return exports;
  const source = ts.transpileModule(fs.readFileSync(sourceFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,require:fromRepo,process:{platform}});
  return exports;
}
test('Windows download cache and installer both use userData/updates, including after restart',async()=>{
  try {
    const {autoUpdater}=load('win32');
    assert.ok(autoUpdater, 'custom updater must be available');
    const helper=await autoUpdater.getOrCreateDownloadHelper();
    const pending=path.join(userData,'updates','pending');
    assert.equal(helper.cacheDirForPendingUpdate,pending);
    const installer=path.join(pending,'setup.exe');
    fs.mkdirSync(pending,{recursive:true});fs.writeFileSync(installer,'installer fixture');
    const sha512=crypto.createHash('sha512').update('installer fixture').digest('base64');
    const info={version:'1.0.1',files:[{url:'setup.exe',sha512}]};
    const fileInfo={url:new URL('https://example.com/setup.exe'),info:info.files[0]};
    await helper.setDownloadedFile(installer,null,info,fileInfo,'setup.exe',true);
    assert.equal(autoUpdater.installerPath,installer);
    const restarted=load('win32').autoUpdater;
    const nextHelper=await restarted.getOrCreateDownloadHelper();
    const logger={info(){},warn(){},error(){}};
    assert.equal(await nextHelper.validateDownloadedPath(installer,info,fileInfo,logger),installer);
    assert.equal(restarted.installerPath,installer);
  } finally {fs.rmSync(userData,{recursive:true,force:true});}
});
test('non-Windows retains the default updater',()=>{
  assert.equal(load('darwin').autoUpdater,fromRepo('electron-updater').autoUpdater);
});
