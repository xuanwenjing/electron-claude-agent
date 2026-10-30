export type AutoLoginResult = { success: true } | { success: false; errorMessage: string };

export const AUTO_LOGIN_FAILED_MSG = "已自动登录，但未登录成功";
