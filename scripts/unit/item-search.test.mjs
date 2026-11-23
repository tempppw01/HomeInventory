// matchesSearch 的单测 —— 「能不能搜到这件物品」只保留一份定义。
//
// 起因(实测):同一件事有三个实现,字段各不相同 ——
//   · 物品页列表过滤:名称 / 编号 / 分类 / 空间名 / 自动标签
//   · 搜索框下拉建议:名称 / 编号 / 分类 / 空间名(少了自动标签)
//   · 接口 /api/items?q=:名称 / 分类 / 备注 / 自动标签(少了编号与空间名)
//
// 于是:把「买二送一」写在**备注**里的物品,接口能搜到、界面上搜不到;
// 输入**物品编号**,下拉能给出建议、接口一条都不返回。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { matchesSearch } from "../../src/lib/item-search.ts";

const item = {
  name: "未漂白厨房用纸",
  itemCode: "INV-20261124-ABCDEF",
  category: "日用",
  notes: "双十一囤货 买二送一",
  autoTags: "纸品,消耗品,需冷藏",
  location: { name: "厨房吊柜" },
};

test("六个字段都能搜到(含此前两边互相缺席的备注与编号)", () => {
  assert.equal(matchesSearch(item, "厨房用纸"), true, "名称");
  assert.equal(matchesSearch(item, "inv-20261124"), true, "物品编号 —— 界面本来就能搜,接口此前搜不到");
  assert.equal(matchesSearch(item, "日用"), true, "分类");
  assert.equal(matchesSearch(item, "买二送一"), true, "备注 —— 接口本来就能搜,界面此前搜不到");
  assert.equal(matchesSearch(item, "需冷藏"), true, "自动标签 —— 列表能搜、下拉此前搜不到");
  assert.equal(matchesSearch(item, "吊柜"), true, "空间名");
});

test("搜不到就是搜不到,不要乱命中", () => {
  for (const term of ["不存在的东西", "冰箱", "INV-0000"]) {
    assert.equal(matchesSearch(item, term), false, `「${term}」不该命中`);
  }
});

test("空搜索词 / 全是空白 = 不筛", () => {
  for (const term of ["", "   ", "\t"]) {
    assert.equal(matchesSearch(item, term), true, `「${JSON.stringify(term)}」应当视为不筛`);
  }
});

test("大小写不敏感,并且前后空白会被去掉", () => {
  assert.equal(matchesSearch(item, "  INV-20261124  "), true);
  assert.equal(matchesSearch({ name: "Coca Cola" }, "coca"), true);
});

test("字段缺失不会炸(空间/备注/标签都可能是空的)", () => {
  const bare = { name: "只有名字" };
  assert.equal(matchesSearch(bare, "名字"), true);
  assert.equal(matchesSearch(bare, "备注"), false);
});

test("三处调用点都用同一份定义(挡住以后又各写一套)", () => {
  // 这条是源码级的守卫:三个文件都必须 import matchesSearch,
  // 而不是各自再写一遍 [item.name, item.itemCode, ...].some(...)
  const files = [
    "src/components/app/app-provider.tsx",
    "src/components/search-box.tsx",
  ];
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    assert.match(code, /from "@\/lib\/item-search"/, `${file} 应当引用 lib/item-search`);
    assert.match(code, /matchesSearch\(/, `${file} 应当调用 matchesSearch`);
  }

  // 接口侧:q 的 OR 条件必须同时包含备注与编号(字段清单与服务端保持一致)
  const route = readFileSync("src/app/api/items/route.ts", "utf8");
  for (const field of ["name", "itemCode", "category", "notes", "autoTags"]) {
    assert.match(route, new RegExp(`${field}: \\{ contains: search \\}`), `接口 q 应当覆盖 ${field}`);
  }
  assert.match(route, /location: \{ name: \{ contains: search \} \}/, "接口 q 应当覆盖空间名");
});