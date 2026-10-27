"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClaudeCli = resolveClaudeCli;
const node_fs_1 = require("node:fs");
const node_module_1 = require("node:module");
const node_path_1 = __importDefault(require("node:path"));
const nodeRequire = (0, node_module_1.createRequire)(__filename);
const PLATFORM_BINARY = {
    "darwin-arm64": "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
    "darwin-x64": "@anthropic-ai/claude-agent-sdk-darwin-x64/claude",
    "win32-x64": "@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
    "win32-arm64": "@anthropic-ai/claude-agent-sdk-win32-arm64/claude.exe",
    "linux-x64": "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
    "linux-arm64": "@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
};
function toUnpackedIfNeeded(resolved) {
    if (!resolved.includes(`${node_path_1.default.sep}app.asar${node_path_1.default.sep}`))
        return resolved;
    return resolved.replace(`${node_path_1.default.sep}app.asar${node_path_1.default.sep}`, `${node_path_1.default.sep}app.asar.unpacked${node_path_1.default.sep}`);
}
/** 开发态包常被 hoist；打包后 optional 平台包在 SDK 的嵌套 node_modules 里 */
function resolvePlatformBinary(subpath) {
    try {
        return nodeRequire.resolve(subpath);
    }
    catch {
        // fall through
    }
    const parts = subpath.split("/");
    // @scope/name/file...
    const pkgName = parts.slice(0, 2).join("/");
    const binaryRel = parts.slice(2).join("/");
    const candidates = [];
    try {
        const sdkRoot = node_path_1.default.dirname(nodeRequire.resolve("@anthropic-ai/claude-agent-sdk/package.json"));
        candidates.push(node_path_1.default.join(sdkRoot, "node_modules", ...pkgName.split("/"), binaryRel));
    }
    catch {
        // ignore
    }
    // dist/main → ../../node_modules（asar 或开发目录）
    candidates.push(node_path_1.default.join(__dirname, "../../node_modules", ...pkgName.split("/"), binaryRel));
    for (const candidate of candidates) {
        const unpacked = toUnpackedIfNeeded(candidate);
        if ((0, node_fs_1.existsSync)(unpacked))
            return unpacked;
        if ((0, node_fs_1.existsSync)(candidate))
            return candidate;
    }
    throw new Error(`找不到 Claude CLI 二进制（${subpath}）。请确认已安装 optionalDependencies，` +
        `或在本机执行: npm i ${pkgName} --force`);
}
/**
 * 解析 Claude Code 原生二进制的真实路径。
 * 打包后必须从 app.asar 改写到 app.asar.unpacked，否则 spawn 会失败。
 */
function resolveClaudeCli() {
    const key = `${process.platform}-${process.arch}`;
    const subpath = PLATFORM_BINARY[key];
    if (!subpath) {
        throw new Error(`当前平台暂不支持打包内置 Claude CLI: ${key}`);
    }
    let resolved = toUnpackedIfNeeded(resolvePlatformBinary(subpath));
    if (!(0, node_fs_1.existsSync)(resolved)) {
        throw new Error(`Claude CLI 路径不存在: ${resolved}`);
    }
    if (process.platform !== "win32") {
        try {
            (0, node_fs_1.chmodSync)(resolved, 0o755);
        }
        catch {
            // 忽略 chmod 失败（某些只读挂载场景）
        }
    }
    return resolved;
}
//# sourceMappingURL=resolveClaudeCli.js.map