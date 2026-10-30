/** 演示：navigate 用 capture 捕获页面接口，等到命中后写入变量 */
export const SAMPLE_CRAWL_CONFIG = {
  maxRetry: 2,
  platform: "ctripEbk",
  needLogin: true,
  workflow: [
    {
      type: "navigate",
      url: "https://ebooking.ctrip.com/comment/commentList",
      name: "open_example",
      capture: { commentNum: "/restapi/soa2/26353/getCommentNumV2" },
    },
  ],
};
