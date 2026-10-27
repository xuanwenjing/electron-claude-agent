#!/usr/bin/env node
/**
 * 下载 python-build-standalone 到 resources/python/<os>-<arch>，随安装包分发。
 *
 * 用法：
 *   node scripts/fetch-python.js                 # 当前平台
 *   node scripts/fetch-python.js current win-x64 # 当前平台 + Windows x64
 *
 * 目录名与 electron-builder 的 ${os}-${arch} 一致（mac-arm64 / mac-x64 / win-x64）。
 * 环境变量：
 *   PYTHON_BUILD_MIRROR  替换下载前缀（默认 GitHub release）
 *   PYTHON_FETCH_FORCE=1 忽略已存在的目录重新下载
 */
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PBS_TAG = "20261013";
const PY_VERSION = "3.12.15";
const PY_MINOR = PY_VERSION.split(".").slice(0, 2).join(".");
const DOWNLOAD_PREFIX =
  process.env.PYTHON_BUILD_MIRROR ||
  `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}`;

const ROOT = path.join(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "resources/python");
const CACHE_DIR = path.join(ROOT, "node_modules/.cache/python-build-standalone");
const REQUIREMENTS = path.join(ROOT, "resources/python-requirements.txt");

const TARGETS = {
  "mac-arm64": { triple: "aarch64-apple-darwin", pipPlatform: "macosx_11_0_arm64" },
  "mac-x64": { triple: "x86_64-apple-darwin", pipPlatform: "macosx_10_13_x86_64" },
  "win-x64": { triple: "x86_64-pc-windows-msvc", pipPlatform: "win_amd64" },
};

function currentTarget() {
  const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  return `${os}-${process.arch}`;
}

function assetName(target) {
  return `cpython-${PY_VERSION}+${PBS_TAG}-${TARGETS[target].triple}-install_only_stripped.tar.gz`;
}

function pythonExe(dir, target) {
  return target.startsWith("win")
    ? path.join(dir, "python.exe")
    : path.join(dir, "bin", "python3");
}

function sitePackages(dir, target) {
  return target.startsWith("win")
    ? path.join(dir, "Lib", "site-packages")
    : path.join(dir, "lib", `python${PY_MINOR}`, "site-packages");
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, buf);
  fs.renameSync(`${dest}.part`, dest);
}

let checksumsCache = null;
async function expectedSha256(name) {
  if (!checksumsCache) {
    const res = await fetch(`${DOWNLOAD_PREFIX}/SHA256SUMS`);
    if (!res.ok) throw new Error(`获取 SHA256SUMS 失败 ${res.status}`);
    checksumsCache = new Map();
    for (const line of (await res.text()).split("\n")) {
      const [hash, file] = line.trim().split(/\s+/);
      if (hash && file) checksumsCache.set(file, hash);
    }
  }
  const hash = checksumsCache.get(name);
  if (!hash) throw new Error(`SHA256SUMS 中没有 ${name}`);
  return hash;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`命令失败: ${cmd} ${args.join(" ")}`);
}

/** 测试集 / IDLE 等运行时用不到，删掉可省几十 MB，也减少 mac 签名公证的文件数 */
function prune(dir, target) {
  const lib = target.startsWith("win") ? path.join(dir, "Lib") : path.join(dir, "lib", `python${PY_MINOR}`);
  for (const name of ["test", "idlelib", "turtledemo"]) {
    fs.rmSync(path.join(lib, name), { recursive: true, force: true });
  }
}

/** mac 上补一个 bin/python，Bash 里 `python` 与 `python3` 都指向内置解释器 */
function ensurePythonAlias(dir, target) {
  if (target.startsWith("win")) return;
  const alias = path.join(dir, "bin", "python");
  if (!fs.existsSync(alias)) fs.symlinkSync("python3", alias);
}

function readRequirements() {
  if (!fs.existsSync(REQUIREMENTS)) return "";
  return fs
    .readFileSync(REQUIREMENTS, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join("\n");
}

/**
 * 本机平台直接用该解释器 pip install；
 * 跨平台（如在 mac 上打 win 包）用本机解释器按目标平台下载 wheel 装到 --target。
 */
function installRequirements(dir, target, hostDir) {
  const reqs = readRequirements();
  const marker = path.join(dir, ".requirements");
  if (!reqs) return;
  if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === reqs) return;

  console.log(`[fetch-python] ${target}: 安装 python-requirements.txt`);
  if (target === currentTarget()) {
    run(pythonExe(dir, target), [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location",
      "-r", REQUIREMENTS,
    ]);
  } else {
    if (!hostDir) throw new Error(`跨平台安装依赖需要先准备本机 Python（${currentTarget()}）`);
    run(pythonExe(hostDir, currentTarget()), [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location",
      "--only-binary=:all:",
      "--platform", TARGETS[target].pipPlatform,
      "--python-version", PY_MINOR,
      "--implementation", "cp",
      "--upgrade",
      "--target", sitePackages(dir, target),
      "-r", REQUIREMENTS,
    ]);
  }
  fs.writeFileSync(marker, reqs);
}

async function fetchTarget(target) {
  const dir = path.join(OUT_ROOT, target);
  const versionFile = path.join(dir, ".version");
  const stamp = `${PY_VERSION}+${PBS_TAG}`;
  if (
    process.env.PYTHON_FETCH_FORCE !== "1" &&
    fs.existsSync(versionFile) &&
    fs.readFileSync(versionFile, "utf8") === stamp
  ) {
    console.log(`[fetch-python] ${target}: 已存在 ${stamp}，跳过下载`);
    return dir;
  }

  const name = assetName(target);
  const archive = path.join(CACHE_DIR, name);
  const expected = await expectedSha256(name);
  if (!fs.existsSync(archive) || sha256(archive) !== expected) {
    console.log(`[fetch-python] ${target}: 下载 ${name}`);
    await download(`${DOWNLOAD_PREFIX}/${encodeURIComponent(name)}`, archive);
    if (sha256(archive) !== expected) throw new Error(`${name} 校验失败`);
  }

  const staging = path.join(OUT_ROOT, `.staging-${target}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  run("tar", ["-xzf", archive, "-C", staging]);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(path.join(staging, "python"), dir);
  fs.rmSync(staging, { recursive: true, force: true });

  prune(dir, target);
  ensurePythonAlias(dir, target);
  fs.writeFileSync(versionFile, stamp);
  console.log(`[fetch-python] ${target}: 完成 → ${path.relative(ROOT, dir)}`);
  return dir;
}

async function main() {
  const host = currentTarget();
  const requested = process.argv.slice(2).map((t) => (t === "current" ? host : t));
  const targets = [...new Set(requested.length ? requested : [host])];

  for (const t of targets) {
    if (!TARGETS[t]) throw new Error(`不支持的目标: ${t}（可选 ${Object.keys(TARGETS).join(" / ")}）`);
  }

  // 跨平台装依赖要借用本机解释器，所以本机目标先处理
  targets.sort((a, b) => (a === host ? -1 : b === host ? 1 : 0));
  let hostDir = null;
  if (readRequirements() && targets.some((t) => t !== host) && !targets.includes(host) && TARGETS[host]) {
    targets.unshift(host);
  }

  for (const t of targets) {
    const dir = await fetchTarget(t);
    if (t === host) hostDir = dir;
    installRequirements(dir, t, hostDir);
  }
}

main().catch((err) => {
  console.error(`[fetch-python] ${err instanceof Error ? err.message : err}`);
  console.error("[fetch-python] 网络受限时可设置 PYTHON_BUILD_MIRROR 指向镜像。");
  process.exit(1);
});
