import { getMainWindow } from "../window";
import { setupAutoUpdater } from "./appUpdater";
import { checkRemoteExtensionUpdate, ensureExtensionInstalled, type ExtensionUpdateResult } from "./extensionUpdater";

function logExtensionUpdate(res: ExtensionUpdateResult): void {
  if (!res.ok) {
    console.error("[ext-update] 更新失败:", res.error);
  } else if (res.updated) {
    console.log(
      `[ext-update] ${res.previousVersion ?? "(无)"} → ${res.version}，` +
        (res.reloadSent ? "已发送 reload_extension" : "扩展未连接，连上后再发送 reload_extension"),
    );
  } else {
    console.log(`[ext-update] ${res.message}（当前 ${res.version ?? "未安装"}）`);
  }
}

const EXTENSION_CHECK_INTERVAL_MS = 60 * 1000;

let installed: Promise<void> | null = null;

/** 查询后台最新插件并按需替换；内置扩展装好之后才执行，避免两边同时替换目录 */
export function checkExtensionUpdate(): void {
  if (!installed) return;
  void installed.then(checkRemoteExtensionUpdate).then(logExtensionUpdate);
}

/** 客户端自动更新 + 扩展安装与远程更新 */
export function startUpdaters(): void {
  setupAutoUpdater(getMainWindow);
  installed = ensureExtensionInstalled().then(
    (dir) => console.log("[ext-install] 扩展目录（chrome://extensions 加载此目录）:", dir),
    (err) => console.error("[ext-install] 安装内置扩展失败:", err),
  );
  checkExtensionUpdate();
  setInterval(checkExtensionUpdate, EXTENSION_CHECK_INTERVAL_MS);
}
