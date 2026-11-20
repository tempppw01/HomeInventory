// 补货建议的创建(4 处调用点共用)。
//
// 抽出来的直接原因:此前是「先 findFirst 再 create」,检查与写入之间没有约束,
// 并发请求会各建一条 —— 实测 6 个并发 PATCH 生成了 **6 条重复的采购建议**,
// 用户的采购清单里就会出现 6 个同样的东西。
//
// 这里做两件事:
//   1. 把「查 + 建」放进调用方的事务里,让它们作为一次写操作串行执行;
//   2. 建完之后再清一遍同名的待采购项(自愈)—— 这样即便竞态仍有极窄窗口,
//      也不会留下成堆的重复项;历史上已经产生的重复项,下次触发时会被顺手清掉。

import type { Prisma } from "@prisma/client";
import { needsRestock, restockQuantity } from "@/lib/item-metrics";

type RestockCandidate = {
  name: string;
  unit: string;
  category: string;
  type: "DURABLE" | "CONSUMABLE";
  quantity: number;
  minQuantity: number;
  remainingPercent: number;
  restockPausedUntil?: Date | string | null;
};

/**
 * 确保该物品有一条待采购建议。
 * @returns 是否新建了建议
 */
export async function ensureRestockSuggestion(
  tx: Prisma.TransactionClient,
  item: RestockCandidate,
  now: number = Date.now(),
): Promise<boolean> {
  if (!needsRestock(item, now)) return false;

  const existing = await tx.shoppingItem.findFirst({
    where: { name: item.name, status: "PENDING" },
    select: { id: true },
  });
  if (!existing) {
    await tx.shoppingItem.create({
      data: {
        name: item.name,
        quantity: restockQuantity(item),
        unit: item.unit,
        category: item.category,
        priority: 2,
        source: "low-stock",
      },
    });
  }

  // 自愈:同名待采购项只留最早的一条(并发下可能被插入多条,历史数据也可能有)
  const pending = await tx.shoppingItem.findMany({
    where: { name: item.name, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (pending.length > 1) {
    await tx.shoppingItem.deleteMany({ where: { id: { in: pending.slice(1).map((row) => row.id) } } });
  }

  return !existing;
}
