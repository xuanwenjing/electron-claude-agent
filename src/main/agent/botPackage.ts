import { z } from "zod";

import type { BotRuntime } from "../../shared/bridgeProtocol";
import { authSession } from "../auth";
import { request } from "../utils/request";

const skillSchema = z.object({
  skill_code: z.string().min(1),
  version: z.union([z.string(), z.number()]).transform((value) => String(value)),
  download_url: z.string().min(1),
  sha256: z.string().optional(),
  expires_at: z.string().optional(),
});

const packageSchema = z.object({
  bot_code: z.string().min(1),
  runtime: z.string().optional(),
  system_prompt: z.string(),
  model: z
    .object({
      name: z.string().optional(),
      max_tokens: z.number().optional(),
      temperature: z.number().optional(),
    })
    .nullish(),
  skills: z.array(skillSchema).nullish(),
});

/** 把 Bot 详情收成 run_agent 要用的提示词、模型和 Skill。 */
export function parseBotRuntime(data: unknown): BotRuntime {
  const parsed = packageSchema.safeParse(data);
  if (!parsed.success) throw new Error("Bot 详情格式不正确");
  const bot = parsed.data;
  if (bot.runtime && bot.runtime !== "claude_agent_sdk") {
    throw new Error(`Bot 运行时不支持：${bot.runtime}`);
  }
  const systemPrompt = bot.system_prompt.trim();
  if (!systemPrompt) throw new Error("Bot 未配置提示词");
  const skills = (bot.skills ?? []).map((skill) => {
    if (!/^https?:\/\//i.test(skill.download_url)) {
      throw new Error(`Skill 下载地址不是 http(s)：${skill.skill_code}`);
    }
    if (skill.expires_at) {
      const expires = Date.parse(skill.expires_at);
      if (Number.isFinite(expires) && expires <= Date.now()) {
        throw new Error(`Skill 下载地址已过期：${skill.skill_code}`);
      }
    }
    return {
      url: skill.download_url,
      version: skill.version,
      ...(skill.sha256 ? { sha256: skill.sha256 } : {}),
    };
  });
  const model = bot.model?.name?.trim();
  return {
    botCode: bot.bot_code,
    systemPrompt,
    ...(model ? { model } : {}),
    skills,
  };
}

/** GET /client/bots/{bot_code}，请求头带当前门店和登录令牌。 */
export async function loadBotRuntime(botCode: string): Promise<BotRuntime> {
  const code = botCode.trim();
  const context = authSession.getRequestContext();
  if (!context.token || !context.outletCode) throw new Error("请先登录并进入门店");
  const body = await request.request({
    url: `/client/bots/${encodeURIComponent(code)}`,
    method: "GET",
  });
  if (!body || body.code !== 200) {
    throw new Error(body?.msg || body?.message || "查询 Bot 失败");
  }
  return parseBotRuntime(body.data);
}
