import { randomUUID } from "node:crypto";

import { getDeviceNumber } from "../push/deviceId";
import { request } from "../utils/request";

export function deviceHeaders() {
  return { "Device-Number": getDeviceNumber() };
}

/** 本地 cron 触发后创建这一次执行。同一任务、门店、计划时间重试会返回同一个实例。 */
export async function createTaskInstance(clientTaskCode: string, scheduledAt: string): Promise<string> {
  const body = await request.request({
    url: "/client/task/instance",
    method: "POST",
    data: { client_task_code: clientTaskCode, scheduled_at: scheduledAt },
    headers: deviceHeaders(),
  });
  const code = body?.data?.instance_code;
  if (body?.code !== 200 || typeof code !== "string" || !code.trim()) {
    throw new Error(body?.msg || body?.message || "创建执行实例失败");
  }
  return code.trim();
}

/** 把结果 JSON 上传到对象存储，返回公网地址。 */
export async function uploadResultJson(payload: unknown): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }), "report.json");
  const body = await request.request({
    url: "/file/uploadFile",
    method: "POST",
    data: form,
  });
  const url = body?.data?.url;
  if (body?.code !== 200 || typeof url !== "string" || !url) {
    throw new Error(body?.msg || body?.message || "上传任务结果失败");
  }
  return url;
}

/** 把对象存储地址交给后端。eventId 由本次上报生成，重试时沿用。 */
export async function reportResultUrl(url: string, eventId = randomUUID()): Promise<void> {
  const body = await request.request({
    url: "/data/event/report",
    method: "POST",
    data: { event_id: eventId, event: "data.report", data: url },
    headers: deviceHeaders(),
  });
  if (body?.code !== 200 || body?.data !== true) {
    throw new Error(body?.msg || body?.message || "上报任务结果失败");
  }
}

/** 上传已经组好的结果，再把地址上报。不落本地文件。 */
export async function publishTaskResult(result: unknown): Promise<string> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("任务结果不是 JSON 对象");
  }
  const url = await uploadResultJson(result);
  await reportResultUrl(url);
  return url;
}
