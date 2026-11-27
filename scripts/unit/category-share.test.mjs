// 「前 N 类 + 其余合并成『其他』」的单元测试:
//   npm run test:unit
//
// 守的是「面板里的百分比加起来 100%,可这个月的钱并没有全在里面」:
// 概览「本月花在哪」与月报都曾把尾部类别 `.slice(0, 4)` 丢掉,而 ShareBar 的百分比
// 是按**传进去的那几行**算的(sharesOf(rows))——于是同一个面板里
// 「本月 ¥10370」和四行之和(¥10332)对不上,百分比照样是 100%,
// 被丢掉的「饮品 ¥37.5」在界面上完全没有痕迹。
// 下面第 2 条用的就是探针库里实测到的那份数据。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CATEGORY_SHARE_ROWS, INVENTORY_SHARE_ROWS, OTHER_LABEL, isSelectableShareRow, topWithOtherRows } from "../../src/lib/category-share.ts";

/** 金额求和按分位收敛,免得浮点尾巴(10369.949999999999)让断言看起来在挑刺 */
const sumOf = (rows) => Number(rows.reduce((total, row) => total + row.value, 0).toFixed(2));

test("分类不超过上限时原样返回,不造「其他」行", () => {
  const rows = topWithOtherRows([["饮品", 38], ["日用", 1154], ["清洁", 2693], ["家电", 5985]], CATEGORY_SHARE_ROWS);
  assert.deepEqual(rows, [
    { label: "家电", value: 5985 },
    { label: "清洁", value: 2693 },
    { label: "日用", value: 1154 },
    { label: "饮品", value: 38 },
  ]);
  assert.ok(!rows.some((row) => row.label === OTHER_LABEL), "不足上限时不该硬塞一条「其他」");
});

test("超过上限时尾部合并成「其他」——探针库实测那份数据的还原", () => {
  // 实测:探针库某月有 5 类,界面上只显示前 4 类,而百分比是 58+26+11+5 = 100%
  const measured = [["家电", 5985], ["清洁", 2693.25], ["日用", 1154.2], ["玩具", 500], ["饮品", 37.5]];
  const rows = topWithOtherRows(measured, CATEGORY_SHARE_ROWS);
  assert.deepEqual(rows, [
    { label: "家电", value: 5985 },
    { label: "清洁", value: 2693.25 },
    { label: "日用", value: 1154.2 },
    { label: "玩具", value: 500 },
    { label: OTHER_LABEL, value: 37.5 },
  ]);
  assert.equal(sumOf(rows), 10369.95, "各条之和必须回到本月总额(修复前界面上四行只有 ¥10332)");
  assert.equal(rows.at(-1).label, OTHER_LABEL, "「其他」必须排在最后,不能挤进前几名");
});

test("各条之和恒等于全部正数项之和(上限怎么取都不变量)", () => {
  const shapes = [
    [["只有一类", 1]],
    [["A", 3], ["B", 2]],
    [["A", 5], ["B", 5], ["C", 5], ["D", 5], ["E", 5]],
    [["家电", 5985], ["清洁", 2693.25], ["日用", 1154.2], ["玩具", 500], ["饮品", 37.5]],
    Array.from({ length: 11 }, (_, index) => [`分类${index}`, (index + 1) * 7.5]),
  ];
  for (const entries of shapes) {
    const positive = Number(entries.reduce((total, [, value]) => total + value, 0).toFixed(2));
    for (const limit of [1, 2, 4, 6, 99]) {
      const rows = topWithOtherRows(entries, limit);
      assert.equal(sumOf(rows), positive, `${entries.length} 类、上限 ${limit} 时总额变了`);
      assert.ok(rows.length <= limit + 1, "最多是上限加一条「其他」");
      assert.equal(rows.length, entries.length > limit ? limit + 1 : entries.length);
      if (entries.length > limit) assert.equal(rows.at(-1).label, OTHER_LABEL);
    }
  }
});

test("0 元与负数不占位、也不算进「其他」", () => {
  // 0 元分类占一个位置没有意义(账本里 unitPrice/quantity 都已限 ≥ 0);
  // 负数不会出现,真出现了也不该被悄悄算进「其他」里。
  assert.deepEqual(topWithOtherRows([["餐费", 0], ["玩具", 20]], CATEGORY_SHARE_ROWS), [{ label: "玩具", value: 20 }]);
  assert.deepEqual(
    topWithOtherRows([["A", 5], ["B", 4], ["C", 3], ["D", 2], ["零元", 0]], CATEGORY_SHARE_ROWS),
    [{ label: "A", value: 5 }, { label: "B", value: 4 }, { label: "C", value: 3 }, { label: "D", value: 2 }],
    "尾巴是 0 元时不该多出一条「其他 ¥0」",
  );
  assert.deepEqual(topWithOtherRows([["A", 5], ["退款", -3]], CATEGORY_SHARE_ROWS), [{ label: "A", value: 5 }]);
});

test("值并列时按标签排序 —— 概览与月报必须取到同一批", () => {
  // 并列时若顺其自然,两页各自「谁先谁后」取决于记录顺序,同一份数据会显示不同的前几名。
  const one = topWithOtherRows([["beta", 10], ["alpha", 10], ["gamma", 10]], 2);
  const other = topWithOtherRows([["gamma", 10], ["beta", 10], ["alpha", 10]], 2);
  assert.deepEqual(one, other, "输入顺序不同,结果必须相同");
  assert.deepEqual(one, [{ label: "alpha", value: 10 }, { label: "beta", value: 10 }, { label: OTHER_LABEL, value: 10 }]);
});

test("空输入返回空数组", () => {
  assert.deepEqual(topWithOtherRows([], CATEGORY_SHARE_ROWS), []);
  assert.deepEqual(topWithOtherRows(new Map(), INVENTORY_SHARE_ROWS), []);
});

test("两处金额面板与库存分布都走同一条合并规则(源码级守卫)", () => {
  // 起因:同一份文件里「库存分布」早就合并出「其他」,而「本月花在哪」和月报各写一遍
  // `.slice(0, 4)` 把尾巴丢掉 —— 规则有两份,坏的那份没人发现。
  const surfaces = {
    概览接口: "src/app/api/dashboard/route.ts",
    家庭月报: "src/app/report/page.tsx",
    库存分布: "src/components/views/dashboard-view.tsx",
  };
  for (const [name, file] of Object.entries(surfaces)) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.match(source, /topWithOtherRows\(/, `${name}(${file})没有用 topWithOtherRows 合并尾部类别`);
  }
  for (const file of ["src/app/api/dashboard/route.ts", "src/app/report/page.tsx"]) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.ok(!/slice\(0, 4\)/.test(source), `${file} 里又出现 slice(0, 4):尾部类别会被整个丢掉,而百分比还是 100%`);
  }
  // 「其他」是好几类合出来的:点了筛不出任何一个分类,必须是纯文字。
  assert.match(readFileSync(new URL("../../src/components/views/dashboard-view.tsx", import.meta.url), "utf8"), /isSelectableShareRow/);
  assert.equal(isSelectableShareRow(OTHER_LABEL), false);
  assert.equal(isSelectableShareRow("家电"), true);
  // 上限是共享常量:两处各写一个 4,改一处就会让同一个月在两页上显示不同分类。
  assert.equal(CATEGORY_SHARE_ROWS, 4);
  assert.ok(INVENTORY_SHARE_ROWS >= CATEGORY_SHARE_ROWS);
});
