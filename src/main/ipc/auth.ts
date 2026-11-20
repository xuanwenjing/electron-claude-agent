import { ipcMain } from "electron";
import { authSession } from "../auth";
import { syncPushChannel } from "../push";
import { syncClientTasks } from "../tasks";
import { checkExtensionUpdate } from "../update";
import { sendToRenderer } from "../window";
import { cancelAllClientCrawls, hasActiveClientCrawls } from "./crawl";
import { toErrorMessage } from "./errors";

export function registerAuthIpc(): void {
  authSession.setTaskControl({
    hasActive: hasActiveClientCrawls,
    cancel: cancelAllClientCrawls,
  });
  let loggedIn = false;
  authSession.onChange = (state) => {
    sendToRenderer("auth:event:session", state);
    syncPushChannel();
    syncClientTasks();
    // 插件版本接口要登录，启动时通常还没恢复会话
    if (state.user && !loggedIn) checkExtensionUpdate();
    loggedIn = !!state.user;
  };
  const protect = async (action: () => unknown) => {
    try {
      return await action();
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  };
  ipcMain.handle("auth:refresh", () =>
    protect(async () => ({ ok: true, session: await authSession.refresh() })),
  );
  ipcMain.handle("auth:getSession", () => authSession.restore());
  ipcMain.handle("auth:sendSms", (_event, mobile: unknown) =>
    protect(async () => {
      await authSession.sendSms(mobile);
      return { ok: true };
    }),
  );
  ipcMain.handle("auth:login", (_event, mobile: unknown, code: unknown) =>
    protect(async () => ({
      ok: true,
      session: await authSession.login(mobile, code),
    })),
  );
  ipcMain.handle("auth:chooseOutlet", (_event, code: unknown) =>
    protect(() => ({ ok: true, session: authSession.chooseOutlet(code) })),
  );
  ipcMain.handle("auth:logout", (_event, confirmed: unknown) =>
    protect(() => authSession.logout(confirmed === true)),
  );
}
