import { authSession } from "../auth";
import { createPushSession, type PushEvent } from "./channel";
import { getDeviceNumber } from "./deviceId";

const listeners = new Set<(event: PushEvent) => void>();
let session: ReturnType<typeof createPushSession> | null = null;

/** 外层 event 固定是 message，业务类型和任务编号在 content 里。 */
function describePush(event: PushEvent): string {
  const content = event.content;
  const detail =
    content && typeof content === "object"
      ? (content as { event?: unknown; client_task_code?: unknown })
      : null;
  const name = typeof detail?.event === "string" ? detail.event : event.event;
  const code =
    typeof detail?.client_task_code === "string" ? ` ${detail.client_task_code}` : "";
  let body = "";
  if (content !== undefined) {
    try {
      body = ` ${JSON.stringify(content)}`;
    } catch {
      body = " [内容无法序列化]";
    }
  }
  return `${name}${code}${body}`;
}

function pushSession(): ReturnType<typeof createPushSession> {
  if (!session) {
    session = createPushSession({
      baseUrl: process.env.CLIENT_API_BASE_URL!,
      deviceNumber: getDeviceNumber(),
      onConnection: (connectionId) => {
        console.log(`[push] 已连接 ${connectionId}`);
      },
      onMessage: (event) => {
        console.log("[push]", describePush(event));
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (error) {
            console.error("[push] 处理消息失败", error);
          }
        }
      },
      onError: (error) => {
        console.error(
          "[push]",
          error instanceof Error ? error.message : error,
        );
      },
    });
  }
  return session;
}

/** 后续业务在这里收推送。connection / heartbeat 不会进来。 */
export function onPushMessage(listener: (event: PushEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 有令牌和门店时连接，否则断开。同一门店重复调用不会重连。 */
export function syncPushChannel(): void {
  try {
    const context = authSession.getRequestContext();
    pushSession().sync(context.token, context.outletCode);
  } catch (error) {
    console.error("[push] 建立连接失败", error);
  }
}

export function stopPushChannel(): void {
  session?.stop();
  session = null;
}
