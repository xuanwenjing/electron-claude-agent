/** 演示：navigate 可通过 need_collect + reg_exp 监听页面接口 */
export const SAMPLE_CRAWL_CONFIG = {
  maxRetry: 2,
  platform: "ctripEbk",
  needLogin: true,
  workflow: [
    {
      type: "navigate",
      url: "https://ebooking.ctrip.com/comment/commentList",
      event: "open_example",
      need_collect: true,
      reg_exp: "/restapi/soa2/26353/getCommentNumV2",
    },
  ],
};
