import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** 本机设备编号，首次生成后写在用户数据目录，重装前保持不变。 */
export function getDeviceNumber(): string {
  const file = path.join(app.getPath("userData"), "device-id");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // 还没有设备编号
  }
  const id = randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, id);
  return id;
}
