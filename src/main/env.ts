import { app } from "electron";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

export function loadEnvFiles(): void {
  const candidates = [
    path.join(__dirname, "../../.env"),
    path.join(process.cwd(), ".env"),
  ];
  // 打包后也可把 .env 放进 userData
  try {
    candidates.push(path.join(app.getPath("userData"), ".env"));
  } catch {
    // app 未 ready 时忽略，后面 whenReady 再补一次
  }
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: true });
    }
  }
}

/** app ready 后再尝试加载 userData/.env */
export function loadUserDataEnv(): void {
  const userEnv = path.join(app.getPath("userData"), ".env");
  if (fs.existsSync(userEnv)) dotenv.config({ path: userEnv, override: false });
}
