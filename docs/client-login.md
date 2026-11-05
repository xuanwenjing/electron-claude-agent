# 客户端登录与门店切换

在 omnivista-admin 项目运行 `pnpm mock`，客户端默认连接 `http://localhost:3000`。
可在客户端项目 `.env` 或打包后 `%APPDATA%/electron-claude-agent/.env` 设置 `CLIENT_API_BASE_URL`，更改后重启客户端。
测试短信验证码为 `123456`（来自 mock 服务，客户端没有绕过验证）。

登录依次调用 `/api/hds/loginByCode`、`/api/auth/me`，默认选择返回列表第一家门店。
令牌、绝对过期时间和上次选择的门店保存在 userData/auth-session.json，令牌不传入渲染进程。
再次启动时调用 /api/auth/me 校验，有效则恢复上次门店；该门店已无权限时选择第一家可用门店。
过期、服务端明确判定凭证失效或账号没有可用门店时清除保存凭证，回到登录页。临时网络/服务错误会保留凭证，显示重试或重新登录入口。退出登录会删除保存凭证。
API 地址变更时不会把旧服务的 token 发送到新地址。
无门店账号登录失败，停留在登录页并提示联系管理员分配门店，不建立客户端会话。

切换门店有活动任务时需确认；取消不改变门店和任务。
确认后取消扩展执行/排队任务、本地 Agent 和待连接/待重试任务，再更新门店。
任务配置包含 `outlet_code`、`outlet_name`、`external_outlets`，结果连同任务启动时的门店配置保存到 `workspace/crawl/<taskId>/result.json`。

验证：主进程编译、前端类型检查/构建、扩展类型检查，以及 `node --test scripts/*.test.cjs`。
