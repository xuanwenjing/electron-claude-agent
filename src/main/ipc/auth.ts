import { ipcMain } from "electron";
import { authSession } from "../auth";
import { sendToRenderer } from "../window";
import { cancelAllClientCrawls, hasActiveClientCrawls } from "./crawl";
import { toErrorMessage } from "./errors";

export function registerAuthIpc(): void {
  authSession.setTaskControl({
    hasActive: hasActiveClientCrawls,
    cancel: cancelAllClientCrawls,
  });
  authSession.onChange = (state) => sendToRenderer("auth:event:session", state);
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
