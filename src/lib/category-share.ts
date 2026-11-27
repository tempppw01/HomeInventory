// 分类占比行:「前 N 类 + 其余合并成『其他』」——**一条都不能少**。
//
// 起因(2026-11-28,真浏览器 + 探针库实测):
//   概览的「本月花在哪」与月报都写 `.slice(0, 4)`,把尾部类别**整个丢掉**;
//   而 ShareBar 的百分比是按**传进去的那几行**算的(`sharesOf(rows)`),
//   于是同一个面板里两个必须相等数字对不上:
//
//     本月        ¥10370      ← 本月真实总额(含 5 个分类)
//     四行之和     ¥10332      ← 家电 5985 + 清洁 2693 + 日用 1154 + 玩具 500
//     百分比       58+26+11+5 = 100%
//     被丢掉的     饮品 ¥37.5   ← 界面上完全没有痕迹,加起来看不出少
//
//   同页的「库存分布」早就把尾部合并成「其他」了(charts.tsx 里 `isSelectable`
//   的注释就是为它写的:聚合出来的「其他」不对应任何分类,不能当筛选条件),
//   这里把同一条规则抽出来,给金额面板也用上。
//
// 「其他」的数值是尾部之和,所以**只要所有记录都非负,面板里的各条之和恒等于总额** ——
// 这条不变量就是回归断言(scripts/unit/category-share.test.mjs)。

/** 聚合行的标签:尾部几类共用这一个名字(与「库存分布」用词一致) */
export const OTHER_LABEL = "其他";

/**
 * 金额面板最多列几类,其余合并成「其他」。
 * 概览与月报共用这一个数:此前两处各写一个 4,改一处就会让同一个月在两页上显示不同分类。
 */
export const CATEGORY_SHARE_ROWS = 4;

/** 「库存分布」按**件数**最多列几类(比金额面板多两类:几千件东西通常比账目分类更散) */
export const INVENTORY_SHARE_ROWS = 6;

export type ShareRow = { label: string; value: number };

/**
 * 按值降序取前 `limit` 项,其余合并成一条「其他」。
 *
 * - 值相同的按标签排,保证概览与月报**两处显示同一批**分类(此前并列时各取各的);
 * - 非正数不参与(0 元分类占位没意义;账本里也不会出现负数,unitPrice/quantity 都已限 ≥ 0),
 *   所以不变量是「各条之和 = 所有正数项之和」;
 * - 不足 `limit` 项时不造「其他」行 —— 硬塞一条 0 只会让人以为还有别的。
 */
export function topWithOtherRows(entries: Iterable<readonly [string, number]>, limit: number): ShareRow[] {
  const sorted = [...entries]
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  if (sorted.length <= limit) return sorted.map(([label, value]) => ({ label, value }));
  const head = sorted.slice(0, limit).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0);
  return [...head, { label: OTHER_LABEL, value: rest }];
}

/**
 * 图表里的某一条能不能点。
 *
 * 「其他」是好几类合出来的,点了既筛不出一个分类、也不该筛 —— 它必须是纯文字。
 * 库存分布用的是这条(金额面板当前不可点,将来加点击时也用同一句)。
 */
export function isSelectableShareRow(label: string): boolean {
  return label !== OTHER_LABEL;
}
