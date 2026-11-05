# 客户端登录与门店选择

在 omnivista-admin 项目运行 `pnpm mock`，客户端默认连接 `http://localhost:3000`。
可在客户端项目 `.env` 或打包后 `%APPDATA%/electron-claude-agent/.env` 设置 `CLIENT_API_BASE_URL`，更改后重启客户端。
测试短信验证码为 `123456`（来自 mock 服务，客户端没有绕过验证）。

登录依次调用 `/api/hds/loginByCode`、`/api/auth/me`。只有一家门店时直接进入；有多家门店时先弹窗选择，选定后才写入本地凭证。进入后不能切换门店，只能退出登录再重新选择。
令牌、绝对过期时间和选定的门店保存在 userData/auth-session.json，令牌不传入渲染进程。
再次启动时调用 /api/auth/me 校验，有效则恢复上次选定的门店。上次门店已无权限且仍有多家门店时，重新弹窗选择；只剩一家时直接进入。
过期、服务端明确判定凭证失效或账号没有可用门店时清除保存凭证，回到登录页。临时网络/服务错误会保留凭证，显示重试或重新登录入口。退出登录会删除保存凭证。
API 地址变更时不会把旧服务的 token 发送到新地址。
无门店账号登录失败，停留在登录页并提示联系管理员分配门店，不建立客户端会话。

退出登录时如果有抓取任务，需要确认。确认后取消扩展执行/排队任务、本地 Agent 和待连接/待重试任务。
任务配置包含 `outlet_code`、`outlet_name`、`external_outlets`，结果连同任务启动时的门店配置保存到 `workspace/crawl/<taskId>/result.json`。

验证：主进程编译、前端类型检查/构建、扩展类型检查，以及 `node --test scripts/*.test.cjs`。
