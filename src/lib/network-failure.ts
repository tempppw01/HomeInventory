// 把「请求失败」翻译成用户能照做的一句话。
//
// 起因(2026-11-28 真机实测):断网时点「加入清单」,界面说的是
//   「网络响应不完整,请重试;已保存的内容不会丢失」
// 而当时的真实情况是:请求根本没发出去(浏览器报 net::ERR_INTERNET_DISCONNECTED),
// 队列里 0 条记录 —— 什么都没保存。两处都说错了:
//   · 原因说错:不是"响应不完整",是"没有网络";
//   · 承诺说过头:"已保存的内容不会丢失"会让人以为采购项已经进了清单,而它没有;
//     而且离线时说"请重试",等于让人反复点一个当前必然失败的动作。
//
// 原来这三件事共用一个正则(failed to fetch / network response / content-length),
// 于是"断网"和"响应被截断"被当成同一件事。它们对用户的含义完全不同:
//   · 响应被截断 —— 服务端很可能已经处理了,重试才是对的;
//   · 断网 —— 请求没离开设备,先别说"已保存"。
export const OFFLINE_WRITE_MESSAGE =
  "现在是离线状态,这一项还没保存;恢复网络后再点一次(刚才填的内容还在)";

/** 浏览器把网络层的失败都报成这几句,厂商不同、文案不同,只能一起认。 */
const NO_CONNECTION = /failed to fetch|network\s?error|load failed|ERR_INTERNET|ERR_NETWORK|ERR_CONNECTION/i;
/** 连接在响应中途断掉(服务端可能已经处理了)。 */
const TRUNCATED = /content-length|network response/i;

/**
 * 只在"这句话确实是网络层失败"时给出译文,否则返回 null ——
 * 调用方据此原样抛出原错误,保住 `fromServer` / `status` / `code` 这些给上层用的字段。
 */
export function networkFailureMessage(message: string, online: boolean): string | null {
  if (!NO_CONNECTION.test(message) && !TRUNCATED.test(message)) return null;
  if (!online) return OFFLINE_WRITE_MESSAGE;
  if (TRUNCATED.test(message)) return "网络响应不完整,请重试;已保存的内容不会丢失";
  return "没能连上服务器,请稍后重试;刚才填的内容还在";
}
