import { getMainWindow } from "../window";
import { setupAutoUpdater } from "./appUpdater";
import { checkRemoteExtensionUpdate, ensureExtensionInstalled } from "./extensionUpdater";

/** 客户端自动更新 + 扩展安装与远程更新 */
export function startUpdaters(): void {
  setupAutoUpdater(getMainWindow);
  ensureExtensionInstalled()
    .then((dir) => {
      console.log("[ext-install] 扩展目录（chrome://extensions 加载此目录）:", dir);
      return checkRemoteExtensionUpdate();
    })
    .catch((err) => console.error("[ext-install] 安装内置扩展失败:", err));
}
