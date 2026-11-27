export const CONSUMPTION_RANK_ROWS = 5;

/** 一条消耗流水里排行用得上的字段(createdAt 允许 Date 或 ISO 串,便于测试直接喂字面量)。 */
export type ConsumptionLogRow = {
  itemId: string | null;
  itemName: string | null;
  createdAt: Date | string;
};

export type ConsumptionRankRow = {
  itemId: string | null;
  itemName: string;
  count: number;
  lastUsedAt: string;
};

function timeOf(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * 把消耗流水聚成「最近用得多」的榜单。
 *
 * 流水的 itemName 是**记录那一刻**的名字快照:`ActivityLog` 里留着旧名是为了让历史说得清
 * (物品改名后,旧流水不该跟着改)。但榜单是「这件东西用得多」,不是「这个名字用得多」——
 * 按名字聚合会把同一件物品改名前后算成两件:实测 6 次消耗(3 次旧名 + 3 次新名)在榜上
 * 变成两行各 3 次,真第一名被 4 次的物品压在下面,还占掉 top-5 的两个名额,把本该上榜的挤出去。
 * 所以按 itemId 归并(历史遗留 itemId 为空的流水退回按名字),再用**库存里的当前名字**显示:
 * 改名后即使还没再消耗过,榜上也不会出现一个库存里根本不存在的名字。
 *
 * 传入的 logs 需按时间倒序(dashboard 查询用 orderBy createdAt desc),首次出现即最近一次。
 */
export function rankConsumption(
  logs: ConsumptionLogRow[],
  options: { nameById?: Map<string, string>; limit?: number } = {},
): ConsumptionRankRow[] {
  const { nameById, limit = CONSUMPTION_RANK_ROWS } = options;
  const merged = new Map<string, ConsumptionRankRow>();

  logs.forEach((entry) => {
    if (!entry.itemName) return;
    const key = entry.itemId ? `id:${entry.itemId}` : `name:${entry.itemName}`;
    const previous = merged.get(key);
    merged.set(key, {
      itemId: entry.itemId,
      // 倒序下第一条就是这个 key 最近一次的名字,后面只累加次数。
      itemName: previous?.itemName || entry.itemName,
      count: (previous?.count || 0) + 1,
      lastUsedAt: previous?.lastUsedAt || new Date(timeOf(entry.createdAt)).toISOString(),
    });
  });

  // 两件真的同名的物品(各有各的 id)在榜上是同一个标签,合成一行:
  // 免得列表里出现两行一模一样的名字,用户没法分辨。
  const byLabel = new Map<string, ConsumptionRankRow>();
  merged.forEach((row) => {
    const label = (row.itemId && nameById?.get(row.itemId)) || row.itemName;
    const previous = byLabel.get(label);
    byLabel.set(label, {
      itemId: previous?.itemId ?? row.itemId,
      itemName: label,
      count: (previous?.count || 0) + row.count,
      lastUsedAt: previous && timeOf(previous.lastUsedAt) >= timeOf(row.lastUsedAt) ? previous.lastUsedAt : row.lastUsedAt,
    });
  });

  return [...byLabel.values()]
    .sort((a, b) =>
      b.count - a.count ||
      timeOf(b.lastUsedAt) - timeOf(a.lastUsedAt) ||
      a.itemName.localeCompare(b.itemName),
    )
    .slice(0, limit);
}
