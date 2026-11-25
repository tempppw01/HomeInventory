// 「撤销消耗」到底该退什么?
//
// 消耗在这套系统里有两种记法:
//   · 数量型:消耗 1 件 → 撤销就是把数量加回来;
//   · 余量型:液体用刻度记(余量 100% → 60%),数量从头到尾没动过。
//
// 撤销逻辑此前不分这两种,一律 `quantity + 1`。实测(瓶装物品 quantity=1、余量 100% → 60%):
// 撤销那条消耗后 **quantity 变成了 2**,余量还是 60% —— 凭空多出一瓶。
// 这是账实不符里最坏的一种:用户在界面上点的是「撤销」,库存却被改写。
//
// 判断抽成纯函数,方便单测:
//   · 记下了 percentBefore → 按余量回退(数量不动);
//   · 没有 percentBefore,但看得出手写的是余量(迁移前的旧记录)→ 拒绝撤销,
//     宁可让用户手动把余量调回去,也不拿库存去猜。
export type ConsumeUndoPlan =
  | { kind: "unit" }
  | { kind: "percent"; percentBefore: number }
  | { kind: "legacy-percent" };

export function planConsumeUndo(activity: { percentBefore?: number | null; detail?: string | null }): ConsumeUndoPlan {
  const percentBefore = activity.percentBefore;
  // 余量只可能是 0..100。越界值只可能来自外部:恢复的备份文件、手改的 JSON、被截断的老备份。
  // 实测(修之前):备份里一条 `percentBefore: 150` 的消耗流水被恢复进库后,
  // 点「撤销消耗」会把物品余量**写成 150%** —— 任何正常写入路径都产生不了的状态。
  // 这种按「旧记录」处理:拒绝撤销,让用户手动把余量调回去,而不是拿一个越界值去改库存。
  if (typeof percentBefore === "number" && Number.isFinite(percentBefore) && percentBefore >= 0 && percentBefore <= 100) {
    return { kind: "percent", percentBefore };
  }
  // 有余量的痕迹(字段存在但值不可用,或旧记录的明细写着「余量 x% → y%」)
  if (percentBefore != null || /余量/.test(activity.detail ?? "")) return { kind: "legacy-percent" };
  return { kind: "unit" };
}
