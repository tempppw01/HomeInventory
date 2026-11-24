// 消耗速度(consumeRate)只留一处算法。
//
// 由来:同一个字段此前在三个地方各算一遍 —— 手动消耗(先建流水再数)、
// 撤销消耗(**先数、后标撤销**)、扫码消耗(压根没算)。同一轮实测到两个后果:
//   · 消耗 3 次(rate=0.1)→ 撤销 1 次:数量退回了,rate 仍是 0.1(应为 2/30)。
//     「还能用几天」「每月花费」于是按一次没发生过的消耗在算,而且不会自愈。
//   · 扫码消耗 3 次:rate 恒为 0 —— 只用扫码的人,系统永远学不到消耗节奏。
//
// 规则一句话:**先改状态,再数流水**。撤销时必须先把 undoneAt 写进去再数,
// 否则那条刚被撤销的消耗还留在分子里(这正是上面第一个错位的成因)。

import type { Prisma } from "@prisma/client";

/** 日均消耗的统计窗口(天)。 */
export const CONSUME_RATE_WINDOW_DAYS = 30;

/** 近 30 天「真正生效」的消耗次数 —— 已撤销的不计。 */
export async function countRecentConsumes(tx: Prisma.TransactionClient, itemId: string, now: number = Date.now()) {
  return tx.activityLog.count({
    where: {
      itemId,
      action: "CONSUME",
      undoneAt: null,
      createdAt: { gte: new Date(now - CONSUME_RATE_WINDOW_DAYS * 86400000) },
    },
  });
}

/** 次数 → 次/天。 */
export function consumeRateFrom(uses: number) {
  return uses / CONSUME_RATE_WINDOW_DAYS;
}

/**
 * 按当前流水重算并写回 consumeRate。
 * 调用点必须在**状态改完之后**调用它(新建的流水已存在 / 撤销的 undoneAt 已写入)。
 */
export async function refreshConsumeRate(tx: Prisma.TransactionClient, itemId: string, now: number = Date.now()) {
  const rate = consumeRateFrom(await countRecentConsumes(tx, itemId, now));
  await tx.item.update({ where: { id: itemId }, data: { consumeRate: rate } });
  return rate;
}
