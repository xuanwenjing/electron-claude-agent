import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PersistedSession, SessionPersistence } from "./session";

const schema = z.object({
  version: z.literal(1),
  apiBaseURL: z.string(),
  token: z.string().min(1),
  expiresAt: z.number().finite().positive(),
  outletCode: z.string().min(1),
});
const apiBaseURL = () =>
  process.env.CLIENT_API_BASE_URL!.replace(
    /\/+$/,
    "",
  );

/** 登录凭证写在用户数据目录的 auth-session.json */
export class FileSessionPersistence implements SessionPersistence {
  private get filename(): string {
    return path.join(app.getPath("userData"), "auth-session.json");
  }
  load(): PersistedSession | null {
    if (!fs.existsSync(this.filename)) return null;
    let value: z.infer<typeof schema>;
    try {
      value = schema.parse(JSON.parse(fs.readFileSync(this.filename, "utf8")));
    } catch {
      this.clear();
      return null;
    }
    // 接口地址换了就丢掉旧 token，避免发给另一台服务器
    if (value.apiBaseURL !== apiBaseURL()) {
      this.clear();
      return null;
    }
    return {
      token: value.token,
      expiresAt: value.expiresAt,
      outletCode: value.outletCode,
    };
  }
  save(session: PersistedSession): void {
    const text = JSON.stringify({
      version: 1,
      apiBaseURL: apiBaseURL(),
      ...session,
    });
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, this.filename);
  }
  clear(): void {
    fs.rmSync(this.filename, { force: true });
  }
}
