import { randomBytes } from "node:crypto";
import { localDateString } from "@/lib/local-date";

export function createItemCode() {
  const date = localDateString().replaceAll("-", "");
  return `INV-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * 一次要生成很多编号时用这个:保证**批内**互不相同。
 *
 * 编号是 3 字节随机(2^24 ≈ 1677 万种),而 `Item.itemCode` 上有唯一索引。
 * 一次导入 1000 行时,按生日问题算,同批里撞车的概率约 **3%** ——
 * 撞一次整个事务回滚,用户看到的是「已存在同名或重复的记录」,1000 行一条都进不去。
 * (实测就是这么红的:同一天连跑两次批量导入验收,第二次整批被拒。)
 *
 * 批内用 Set 保证绝对不重复;与库里**已有**编号撞车的概率仍有约 0.02%,
 * 由调用方在 P2002 上重试兜住(重试会重新掷一遍)。
 */
export function createItemCodeBatch(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(createItemCode());
  return [...codes];
}
