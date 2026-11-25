// 「恢复备份」时的取值守卫 —— 外部文件进库的唯一通道,必须和应用自己的写入规则对齐。
//
// 由来(全部是实测出来的,修之前都真的写进去了):
//   · 物品走了 zod,负数量 / 250% 余量会被拒绝并说明原因 ✓
//   · 盘点只查了 `Number.isFinite` → `total: 1000000000, confirmed: 999999999` 原样落库,
//     而同样这个值走接口会被 400 拒掉;
//   · 价格记录只查了 `typeof === "number"` → `unitPrice: -100, quantity: -2` 落库,
//     月报支出被负数拉低;
//   · 活动记录的两个余量标记原样搬过去 → 恢复后点「撤销消耗」把物品余量写成 150%。
//
// 这三条的共同点:备份文件是**唯一**一个用户能塞进任意数字、而我们又没法校验来源的入口
// (老版本导出的、手改的、下载截断的)。所以规则就一条:凡是库里别处禁止的值,这里也不许进。

/** 余量只可能是 0..100;越界/非数字一律当成「没有这个标记」 */
export function usablePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** 金额与数量不可能为负(界面里最小就是 0) */
export function usableAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}