# Electron Claude Agent

最小可运行示例：**Electron 窗口点按钮 → `claude-agent-sdk` 的 `query()`**，支持：

- Skill（打包内置 `workspace-summary`）
- 系统命令（Bash）
- macOS / Windows 打包（asarUnpack + entitlements）

## 快速开始

```bash
cd /Users/winky/workshop/electron-claude-agent
npm install
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY（或 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL）
npm start
# 开发热编译：npm run dev
```

窗口打开后点「运行 query」。日志区会流式显示工具调用与结果。

> 若在 Cursor 终端里直接跑 `electron .` 失败，是因为环境变量 `ELECTRON_RUN_AS_NODE=1` 会把 `require('electron')` 变成路径字符串。请用 `npm start`（内部已清除该变量）。

## 目录说明

| 路径 | 作用 |
|------|------|
| `src/main/runAgent.ts` | 调用 `query()`，配置 Skill / Bash / 权限 |
| `src/main/resolveClaudeCli.ts` | 解析 Claude 原生二进制（处理 asar 解包） |
| `resources/skills-plugin/` | 内置 Skill 插件 |
| `workspace/` | Agent 工作区（cwd） |
| `build/entitlements.mac.plist` | macOS 允许 spawn 子进程 |

## 打包

```bash
# 当前 Mac 上打 macOS 包
npm run build:mac

# 打 Windows 包（建议在 Windows 机器或 CI 上执行；跨平台需额外环境）
npm run build:win
```

产物在 `release/`。

### 跨平台构建注意

`@anthropic-ai/claude-agent-sdk` 通过 optionalDependencies 带各平台二进制。  
在 **目标平台** 上 `npm install` 再打包最稳妥。若要在 Mac 上交叉打 Windows：

```bash
npm i @anthropic-ai/claude-agent-sdk-win32-x64 --force
npm run build:win
```

macOS 正式分发还需 Apple 开发者证书签名与公证；本仓库已写好 `hardenedRuntime` + entitlements，证书需你本地配置。

## 安全说明（演示默认）

当前演示对 Bash **自动批准**，仅适合本地自用验证。  
上线前请改成弹窗确认，并收紧 `disallowedTools` / 工作区白名单。
