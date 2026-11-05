import { FileSessionPersistence } from "./persistence";
import { request, setRequestContextProvider } from "../utils/request";
import { AuthSession } from "./session";

export const authSession = new AuthSession(async (url, data, token) => {
  const body = await request.request(
    { url, method: "POST", data, timeout: 20_000 },
    token ? { token } : undefined,
  );
  if (!body || body.code !== 200)
    throw Object.assign(new Error(body?.msg || body?.message || "请求失败"), {
      code: body?.code,
    });
  return body.data;
}, new FileSessionPersistence());

setRequestContextProvider(() => authSession.getRequestContext());
