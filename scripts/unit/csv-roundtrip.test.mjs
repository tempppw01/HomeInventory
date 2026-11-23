// 导出的 CSV 必须能被自己导回来 —— 这条契约此前没有任何检查。
//
// 导出（物品页「导出当前筛选为 CSV」）与导入（`csvToItems` + 接口里的空间路径解析）
// 是两套实现,中间只靠列名与取值约定衔接:列名、类型写成「消耗品/耐用品」、日期写成纯日期、
// 位置写成「厨房/吊柜」这样的路径。任何一处改了,用户就会拿到「导出的文件导不回来」。
//
// 这里用**导出侧真实的列名与取值**拼一份 CSV(走 csvStringify,与实际导出用的是同一个函数),
// 再喂给导入解析器,逐字段核对,并把位置路径还原成空间层级。

import { test } from "node:test";
import assert from "node:assert/strict";

import { csvStringify } from "../../src/lib/csv.ts";
import { csvToItems } from "../../src/lib/csv-import.ts";
import { formatLocationPath, parseLocationPath, resolveLocationPaths } from "../../src/lib/location-path.ts";

// 与 items-view 的 exportCsv 完全一致的表头
const EXPORT_HEADER = ["名称", "数量", "单位", "分类", "类型", "存放位置", "剩余量(%)", "购入日期", "到期日期", "单价", "物品编号", "备注"];

const exportRows = [
  ["未漂白厨房用纸", 3, "包", "日用", "耐用品", "厨房/吊柜", 100, "2026-11-20", "2026-12-14", 19.9, "INV-20261124-AAAAAA", "双十一囤货"],
  ["鲜奶", 2, "盒", "饮品", "消耗品", "冰箱/冷藏", 60, "", "2026-12-01", 12.5, "INV-20261124-BBBBBB", ""],
  ["胶带", 1, "卷", "文具", "耐用品", "", 100, "", "", "", "INV-20261124-CCCCCC", "带,逗号\"与引号"],
];

const csvText = csvStringify(EXPORT_HEADER, exportRows);

test("导出侧的表头能直接被导入解析器认出来(没有缺列 / 改名的漂移)", () => {
  const { items, issues } = csvToItems(csvText);
  assert.equal(issues.length, 0, `不该有解析问题:${JSON.stringify(issues)}`);
  assert.equal(items.length, 3);
});

test("逐字段往返:名称 / 数量 / 单位 / 分类 / 类型 / 日期 / 单价 / 编号 / 备注", () => {
  const { items } = csvToItems(csvText);
  const paper = items[0];
  assert.equal(paper.name, "未漂白厨房用纸");
  assert.equal(paper.quantity, 3);
  assert.equal(paper.unit, "包");
  assert.equal(paper.category, "日用");
  assert.equal(paper.type, "DURABLE", "「耐用品」要还原成枚举");
  assert.equal(paper.expiryDate, "2026-12-14", "日期原样,不许被时区挪一天");
  assert.equal(paper.purchaseDate, "2026-11-20");
  assert.equal(paper.price, 19.9);
  assert.equal(paper.remainingPercent, 100);
  assert.equal(paper.locationName, "厨房/吊柜", "位置以路径形式带过来");
  assert.equal(paper.notes, "双十一囤货");

  assert.equal(items[1].type, "CONSUMABLE", "「消耗品」要还原成枚举");
});

test("带逗号与引号的备注不会被拆坏(往返不丢字符)", () => {
  const { items } = csvToItems(csvText);
  assert.equal(items[2].notes, "带,逗号\"与引号");
});

test("位置路径能还原成已有空间的 id(而不是新建一个叫「厨房/吊柜」的平级空间)", () => {
  const { items } = csvToItems(csvText);
  const existing = [
    { id: "L1", name: "厨房", parentId: null },
    { id: "L2", name: "吊柜", parentId: "L1" },
    { id: "L3", name: "冰箱", parentId: null },
    { id: "L4", name: "冷藏", parentId: "L3" },
  ];
  const plan = resolveLocationPaths(existing, items.map((item) => String(item.locationName ?? "")).filter(Boolean));
  assert.equal(plan.pathToId.get("厨房/吊柜"), "L2", "应当命中已有的「吊柜」");
  assert.equal(plan.pathToId.get("冰箱/冷藏"), "L4");
  assert.deepEqual(plan.creations, [], "已有空间不该被重复创建");
  assert.deepEqual(plan.issues, []);
});

test("缺失的层级会被补出来,且父在前(与导出路径格式一致)", () => {
  const plan = resolveLocationPaths([{ id: "L1", name: "厨房", parentId: null }], ["厨房/抽屉/分格"]);
  assert.deepEqual(plan.creations.map((entry) => entry.path), ["厨房/抽屉", "厨房/抽屉/分格"], "父在前,顺序稳定");
  assert.equal(plan.creations[1].parentPath, "厨房/抽屉");
});

test("界面显示用「 / 」、CSV 用「/」—— 两种写法都能解析回同一层级", () => {
  // 用户照界面上的写法手填「厨房 / 吊柜」也得认
  assert.deepEqual(parseLocationPath("厨房 / 吊柜"), ["厨房", "吊柜"]);
  assert.deepEqual(parseLocationPath("厨房/吊柜"), ["厨房", "吊柜"]);
  // 导出侧固定用紧凑写法,并保证「解析 → 拼回」是幂等的
  assert.equal(formatLocationPath(["厨房", "吊柜"]), "厨房/吊柜");
  assert.equal(formatLocationPath(parseLocationPath("厨房 / 吊柜")), "厨房/吊柜");
});