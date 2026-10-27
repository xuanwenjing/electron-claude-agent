import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const nodeRequire = createRequire(__filename);

const PLATFORM_BINARY: Record<string, string> = {
  "darwin-arm64": "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
  "darwin-x64": "@anthropic-ai/claude-agent-sdk-darwin-x64/claude",
  "win32-x64": "@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
  "win32-arm64": "@anthropic-ai/claude-agent-sdk-win32-arm64/claude.exe",
  "linux-x64": "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
  "linux-arm64": "@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
};

function toUnpackedIfNeeded(resolved: string): string {
  if (!resolved.includes(`${path.sep}app.asar${path.sep}`)) return resolved;
  return resolved.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
}

/**
 * 开发态包常被 hoist 到顶层；打包后 optional 平台包在 SDK 的嵌套 node_modules。
 * 注意：不能 resolve SDK 的 package.json（exports 未导出该路径）。
 */
function resolvePlatformBinary(subpath: string): string {
  try {
    return nodeRequire.resolve(subpath);
  } catch {
    // fall through
  }

  // 以 SDK 入口为基准 resolve，可命中其嵌套 node_modules
  try {
    const sdkEntry = nodeRequire.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkRequire = createRequire(sdkEntry);
    return sdkRequire.resolve(subpath);
  } catch {
    // fall through
  }

  const parts = subpath.split("/");
  const pkgName = parts.slice(0, 2).join("/");
  const binaryRel = parts.slice(2).join("/");

  const candidates: string[] = [];
  try {
    const sdkRoot = path.dirname(nodeRequire.resolve("@anthropic-ai/claude-agent-sdk"));
    candidates.push(path.join(sdkRoot, "node_modules", ...pkgName.split("/"), binaryRel));
  } catch {
    // ignore
  }
  candidates.push(
    path.join(__dirname, "../../../node_modules", ...pkgName.split("/"), binaryRel),
  );

  for (const candidate of candidates) {
    const unpacked = toUnpackedIfNeeded(candidate);
    if (existsSync(unpacked)) return unpacked;
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `找不到 Claude CLI 二进制（${subpath}）。请确认已安装 optionalDependencies，` +
      `或在本机执行: npm i ${pkgName} --force`,
  );
}

/**
 * 解析 Claude Code 原生二进制的真实路径。
 * 打包后必须从 app.asar 改写到 app.asar.unpacked，否则 spawn 会失败。
 */
export function resolveClaudeCli(): string {
  const key = `${process.platform}-${process.arch}`;
  const subpath = PLATFORM_BINARY[key];
  if (!subpath) {
    throw new Error(`当前平台暂不支持打包内置 Claude CLI: ${key}`);
  }

  const resolved = toUnpackedIfNeeded(resolvePlatformBinary(subpath));

  if (!existsSync(resolved)) {
    throw new Error(`Claude CLI 路径不存在: ${resolved}`);
  }

  if (process.platform !== "win32") {
    try {
      chmodSync(resolved, 0o755);
    } catch {
      // 忽略 chmod 失败（某些只读挂载场景）
    }
  }

  return resolved;
}
