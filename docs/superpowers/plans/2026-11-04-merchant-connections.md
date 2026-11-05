商家连接：携程 EBK、美团、飞猪、抖音四张平台卡片；绑定状态来自当前门店 external_outlets。绑定仅区分 platform，不使用 channel。
复用统一 crawlTasks 和扩展 navigate 酒店信息采集，结果需包含本次采集标记及有效 hotelName/hotelCode；禁止使用旧缓存或其他标签信息。主进程保存待确认数据，前端仅提交 taskId。用户确认后调用 /admin/outlets/bind，然后刷新 /api/auth/me；切店/退出取消任务并使确认失效。未连接扩展时保持原有连接指引。
验证：编译/前端类型与构建/扩展类型及构建；绑定任务、取消、旧结果防护及真实 mock API 流程；界面四平台和确认交互。
