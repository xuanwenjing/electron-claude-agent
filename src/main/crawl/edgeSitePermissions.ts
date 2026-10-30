import fs from "node:fs/promises";
import path from "node:path";

const PREFERENCES_FILE = "Preferences";

function edgeUserDataDir(): string | null {
  if (process.platform === "darwin") {
    return path.join(process.env.HOME ?? "", "Library/Application Support/Microsoft Edge");
  }
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft/Edge/User Data") : null;
  }
  return null;
}

type EdgePreferences = {
  extensions?: { user_permissions?: { restricted_sites?: string[] } };
};

/** 移除 Edge 各配置的「不允许使用扩展」站点（extensions.user_permissions.restricted_sites），返回改动的配置目录名 */
export async function unblockSiteInEdge(origin: string): Promise<string[]> {
  const userDataDir = edgeUserDataDir();
  if (!userDataDir) throw new Error(`暂不支持在 ${process.platform} 上修改 Edge 配置`);
  const entries = await fs.readdir(userDataDir, { withFileTypes: true });
  const changed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(userDataDir, entry.name, PREFERENCES_FILE);
    let prefs: EdgePreferences;
    try {
      prefs = JSON.parse(await fs.readFile(file, "utf8")) as EdgePreferences;
    } catch {
      continue;
    }
    const userPermissions = prefs.extensions?.user_permissions;
    const sites = userPermissions?.restricted_sites;
    if (!userPermissions || !Array.isArray(sites) || !sites.includes(origin)) continue;
    userPermissions.restricted_sites = sites.filter((site) => site !== origin);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(prefs), "utf8");
    await fs.rename(tmp, file);
    changed.push(entry.name);
  }
  if (!changed.length) throw new Error(`Edge 配置中未找到 ${origin} 的「不允许使用扩展」设置`);
  return changed;
}
