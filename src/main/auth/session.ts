import { normalizePlatform } from "../../shared/merchant";
import { z } from "zod";
import type { AuthResult, AuthState } from "../../shared/auth";

const profileSchema = z.object({
  id: z.number(),
  name: z.string(),
  mobile: z.string(),
  outlets: z.array(
    z.object({
      outlet_code: z.string().min(1),
      outlet_name: z.string(),
      external_outlets: z.array(
        z.object({
          code: z.string(),
          name: z.string(),
          group: z.string().transform(normalizePlatform),
        }),
      ),
    }),
  ),
});
type Post = (url: string, data: unknown, token?: string) => Promise<unknown>;
const emptyState = (): AuthState => ({ user: null, outlet: null });

export type PersistedSession = {
  token: string;
  expiresAt: number;
  outletCode: string;
};
export interface SessionPersistence {
  load(): PersistedSession | null;
  save(session: PersistedSession): void;
  clear(): void;
}

/** 凭证仅保留在主进程，并写入本机用户数据目录。 */
export class AuthSession {
  private state = emptyState();
  private token = "";
  private expiresAt = 0;
  private revision = 0;
  private changing = false;
  private restored = false;
  private restoring: Promise<AuthState> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private tasks = { hasActive: () => false, cancel: (_reason: string) => {} };
  onChange: (state: AuthState) => void = () => {};

  constructor(
    private readonly post: Post,
    private readonly persistence?: SessionPersistence,
  ) {}
  restore(): Promise<AuthState> {
    if (this.restored || this.getState().user)
      return Promise.resolve(this.getState());
    if (this.restoring) return this.restoring;
    this.restoring = this.restoreSaved().finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }
  private async restoreSaved(): Promise<AuthState> {
    if (this.changing) throw new Error("正在处理登录状态，请稍后重试");
    this.changing = true;
    try {
      const saved = this.persistence?.load();
      if (!saved) {
        this.restored = true;
        return this.state;
      }
      if (saved.expiresAt <= Date.now()) {
        this.clear("登录已过期");
        return this.state;
      }
      let user;
      try {
        user = profileSchema.parse(
          await this.post("/auth/me", {}, saved.token),
        );
      } catch (error) {
        const code = String((error as { code?: unknown })?.code ?? "");
        if (
          [
            "401",
            "unauthorized",
            "AUTH-INVALID-001",
            "AUTH-REFRESH-INVALID",
            "AUTH-TOKEN-INVALID",
            "token无效",
          ].includes(code)
        ) {
          this.clear("登录凭证已失效");
          return this.state;
        }
        throw new Error("暂时无法验证登录状态，请检查网络或服务后重试");
      }
      if (saved.expiresAt <= Date.now()) {
        this.clear("登录已过期");
        return this.state;
      }
      if (!user.outlets.length) {
        this.clear("当前账号没有可用门店");
        return this.state;
      }
      const outlet =
        user.outlets.find((item) => item.outlet_code === saved.outletCode) ??
        (user.outlets.length === 1 ? user.outlets[0] : null);
      if (outlet)
        this.persistence?.save({ ...saved, outletCode: outlet.outlet_code });
      this.token = saved.token;
      this.expiresAt = saved.expiresAt;
      this.state = { user, outlet };
      this.revision++;
      this.restored = true;
      this.scheduleExpiry();
      this.onChange(this.state);
      return this.state;
    } finally {
      this.changing = false;
    }
  }
  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(
      () => {
        if (Date.now() < this.expiresAt) {
          this.scheduleExpiry();
          return;
        }
        try {
          this.clear("登录已过期，任务已中断");
        } catch {
          console.error("[auth] 无法清理已过期的本地凭证");
        }
      },
      Math.min(Math.max(0, this.expiresAt - Date.now()), 2_147_483_647),
    );
    this.expiryTimer.unref?.();
  }
  setTaskControl(control: typeof this.tasks): void {
    this.tasks = control;
  }
  getState(): AuthState {
    if (this.token && Date.now() >= this.expiresAt)
      this.clear("登录已过期，任务已中断");
    return this.state;
  }
  private clear(reason: string): void {
    this.tasks.cancel(reason);
    clearTimeout(this.expiryTimer);
    this.token = "";
    this.state = emptyState();
    this.expiresAt = 0;
    this.restored = true;
    this.revision++;
    try {
      this.persistence?.clear();
    } finally {
      this.onChange(this.state);
    }
  }
  private mobile(value: unknown): string {
    if (typeof value !== "string" || !/^1\d{10}$/.test(value.trim()))
      throw new Error("请输入正确的 11 位手机号");
    return value.trim();
  }
  async sendSms(mobile: unknown): Promise<void> {
    await this.post("/api/login/sendSms", {
      mobile: this.mobile(mobile),
      area_code: "86",
    });
  }
  async login(mobile: unknown, code: unknown): Promise<AuthState> {
    if (this.changing) throw new Error("正在处理，请稍后再试");
    if (this.getState().user) throw new Error("请先退出当前账号");
    const phone = this.mobile(mobile);
    if (typeof code !== "string" || !/^\d{4}$/.test(code.trim()))
      throw new Error("请输入 4 位验证码");
    this.changing = true;
    try {
      const credentials = z
        .object({
          access_token: z.string().min(1),
          expire_at: z.number().positive(),
        })
        .parse(
          await this.post("/api/hds/loginByCode", {
            mobile: phone,
            sms_code: code.trim(),
            area_code: "86",
          }),
        );
      const expiresAt = Date.now() + credentials.expire_at * 1000;
      const user = profileSchema.parse(
        await this.post("/auth/me", {}, credentials.access_token),
      );
      if (!user.outlets.length)
        throw new Error("当前账号没有可用门店，请联系管理员分配门店");
      const outlet = user.outlets.length === 1 ? user.outlets[0] : null;
      this.token = credentials.access_token;
      this.expiresAt = expiresAt;
      if (outlet) {
        this.persistence?.save({
          token: credentials.access_token,
          expiresAt,
          outletCode: outlet.outlet_code,
        });
      }
      this.state = { user, outlet };
      this.revision++;
      this.restored = true;
      this.scheduleExpiry();
      this.onChange(this.state);
      return this.state;
    } finally {
      this.changing = false;
    }
  }
  async refresh(): Promise<AuthState> {
    const state = this.getState();
    if (!state.user) throw new Error("请先登录");
    if (this.changing) throw new Error("正在切换登录状态，请稍后再试");
    if (!state.outlet) throw new Error("请先选择门店");
    const outletCode = state.outlet.outlet_code;
    const revision = this.revision;
    const user = profileSchema.parse(await this.post("/auth/me", {}));
    if (!this.getState().user || this.changing || revision !== this.revision)
      throw new Error("门店或登录状态已变更，请重试");
    const outlet = user.outlets.find((item) => item.outlet_code === outletCode);
    if (!outlet) {
      this.clear("当前门店访问权限已失效");
      throw new Error("当前门店已不可用，请重新登录");
    }
    this.state = { user, outlet };
    this.onChange(this.state);
    return this.state;
  }
  getRequestContext(): { token?: string; outletCode?: string } {
    const state = this.getState();
    return state.user
      ? { token: this.token, outletCode: state.outlet?.outlet_code }
      : {};
  }
  chooseOutlet(code: unknown): AuthState {
    if (this.changing) throw new Error("正在处理，请稍后再试");
    const user = this.state.user;
    if (!user) throw new Error("请先登录");
    if (this.state.outlet) throw new Error("已进入门店，请退出登录后重新选择");
    if (typeof code !== "string" || !code) throw new Error("请选择门店");
    const outlet = user.outlets.find((item) => item.outlet_code === code);
    if (!outlet) throw new Error("无权访问该门店");
    this.persistence?.save({
      token: this.token,
      expiresAt: this.expiresAt,
      outletCode: outlet.outlet_code,
    });
    this.state = { user, outlet };
    this.revision++;
    this.onChange(this.state);
    return this.state;
  }
  async logout(confirmed: boolean): Promise<AuthResult> {
    if (this.changing) throw new Error("正在处理，请稍后再试");
    if (this.tasks.hasActive() && !confirmed)
      return {
        ok: false,
        confirmationRequired: true,
        error: "退出登录会中断抓取任务，是否继续？",
      };
    const token = this.token;
    this.changing = true;
    try {
      this.clear("退出登录，抓取任务已取消");
      // Local logout must still succeed when the server is unavailable.
      if (token) await this.post("/api/hds/logout", {}, token).catch(() => {});
      return { ok: true, session: this.state };
    } finally {
      this.changing = false;
    }
  }
}
