import { net } from "electron";
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";

import type { RunAgentSkill } from "../../shared/bridgeProtocol";

/** Agent 工作空间内的 Skill 插件目录 */
const SKILLS_DIR = ".skills";
const PLUGIN_NAME = "workflow-skills";
const SKILL_NAME_RE = /^[\w-][\w.-]*$/;
/** 进程内最多缓存的 zip 数，超出淘汰最早的 */
const MAX_CACHED_ZIPS = 50;

/** 进程共享的下载缓存：url@version → zip（约定同一 version 内容不变），并发请求共用一次下载 */
const zipCache = new Map<string, Promise<Buffer>>();

function validateSkills(skills: RunAgentSkill[]): void {
  for (const skill of skills) {
    if (typeof skill?.url !== "string" || !/^https?:\/\//i.test(skill.url)) {
      throw new Error(`Skill url 必须是 http(s) 地址: ${String(skill?.url)}`);
    }
    if (typeof skill.version !== "string" || !skill.version.trim()) {
      throw new Error(`Skill 缺少 version: ${skill.url}`);
    }
  }
}

async function download(url: string): Promise<Buffer> {
  const res = await net.fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`下载 Skill 包失败: HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function loadZip(skill: RunAgentSkill, log: (msg: string) => void): Promise<Buffer> {
  const key = `${skill.url}@${skill.version}`;
  const cached = zipCache.get(key);
  if (cached) {
    zipCache.delete(key);
    zipCache.set(key, cached);
    log(`复用 Skill 包: ${key}`);
    return cached;
  }
  log(`下载 Skill 包: ${key}`);
  const pending = download(skill.url);
  zipCache.set(key, pending);
  pending.catch(() => {
    if (zipCache.get(key) === pending) zipCache.delete(key);
  });
  if (zipCache.size > MAX_CACHED_ZIPS) zipCache.delete(zipCache.keys().next().value!);
  return pending;
}

function skillNameOf(skillDir: string, fallback: string): string {
  const md = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const name = md.match(/^---[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim() ?? "";
  return SKILL_NAME_RE.test(name) ? name : fallback;
}

/**
 * 把 skills 解压进 <workDir>/.skills（Claude 插件结构：skills/<name>/SKILL.md），返回插件目录。
 * 每个 Agent 各解压一份，互不影响；下载走进程共享缓存。
 */
export async function installSkills(
  skills: RunAgentSkill[],
  workDir: string,
  log: (msg: string) => void,
): Promise<string> {
  validateSkills(skills);
  const zips = await Promise.all(skills.map((skill) => loadZip(skill, log)));

  const pluginDir = path.join(workDir, SKILLS_DIR);
  const skillsDir = path.join(pluginDir, "skills");
  const rawDir = path.join(pluginDir, "raw");
  fs.mkdirSync(skillsDir, { recursive: true });
  try {
    zips.forEach((zip, i) => {
      const extracted = path.join(rawDir, String(i));
      new AdmZip(zip).extractAllTo(extracted, true);
      if (!fs.existsSync(path.join(extracted, "SKILL.md"))) {
        throw new Error(`Skill 包根目录没有 SKILL.md: ${skills[i].url}`);
      }
      const name = skillNameOf(extracted, `skill-${i + 1}`);
      const target = path.join(skillsDir, name);
      if (fs.existsSync(target)) throw new Error(`Skill 重名: ${name}`);
      fs.renameSync(extracted, target);
      log(`Skill 已安装: ${name} (${skills[i].url}@${skills[i].version})`);
    });
  } finally {
    fs.rmSync(rawDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: PLUGIN_NAME, version: "0.0.0", description: "workflow run_agent skills" }, null, 2),
  );
  return pluginDir;
}
