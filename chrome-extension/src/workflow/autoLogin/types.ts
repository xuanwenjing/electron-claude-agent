export type AutoLoginResult = { success: true } | { success: false; errorMessage: string };

export type AutoLoginOptions = {
  /** 平台登录账号（飞猪需要） */
  account?: string;
};

export const AUTO_LOGIN_FAILED_MSG = "已自动登录，但未登录成功";
