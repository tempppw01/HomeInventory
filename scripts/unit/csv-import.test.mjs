// CSV 导入解析的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCsv, csvToItems, importResultText } from "../../src/lib/csv-import.ts";

const HEADER = "名称,数量,单位,分类,类型,存放位置,剩余量(%),购入日期,到期日期,单价,物品编号,备注";

test("解析基本 CSV", () => {
  const rows = parseCsv("名称,数量\n可乐,3");
  assert.deepEqual(rows, [["名称", "数量"], ["可乐", "3"]]);
});

test("带引号的字段、引号内的逗号与换行", () => {
  const rows = parseCsv('名称,备注\n"可乐,大瓶","第一行\n第二行"');
  assert.deepEqual(rows[1], ["可乐,大瓶", "第一行\n第二行"]);
});

test("引号转义与 CRLF、BOM", () => {
  const rows = parseCsv('\uFEFF名称,备注\r\n"他说""好""",x\r\n');
  assert.deepEqual(rows[1], ['他说"好"', "x"]);
});

test("末尾空行被忽略", () => {
  assert.equal(parseCsv("a,b\n1,2\n\n").length, 2);
});

test("按导出的表头映射成导入结构", () => {
  const csv = [HEADER, "可乐,6,罐,饮品,消耗品,冰箱,100,2026/01/02,2027/01/02,2.5,INV-1,夏天的"].join("\n");
  const { items, issues } = csvToItems(csv);
  assert.equal(issues.length, 0);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    name: "可乐",
    category: "饮品",
    type: "CONSUMABLE",
    quantity: 6,
    remainingPercent: 100,
    unit: "罐",
    price: 2.5,
    purchaseDate: "2026-01-02",
    expiryDate: "2027-01-02",
    notes: "夏天的",
    locationName: "冰箱",
  });
});

test("存放位置列会带出空间名,交给接口解析", () => {
  const csv = [HEADER, "洗衣液,2,瓶,清洁,消耗品,卫生间,,,2027/01/01,39,,"].join("\n");
  const { items } = csvToItems(csv);
  assert.equal(items[0].locationName, "卫生间");
});

test("没有位置列时不产生 locationName 字段", () => {
  const csv = ["名称,数量", "抹布,2"].join("\n");
  const { items } = csvToItems(csv);
  assert.equal("locationName" in items[0], false);
});

test("结果文案会说明新建了哪些空间", () => {
  assert.match(importResultText(3, [], [], ["卫生间", "阳台"]), /新建空间 2 个\(卫生间、阳台\)/);
  assert.match(importResultText(3, [], []), /^已导入 3 件物品$/);
});

test("缺名称的行记入问题而不是静默丢弃", () => {
  const csv = [HEADER, ",3,罐,饮品,消耗品,,,,,,,"].join("\n");
  const { items, issues } = csvToItems(csv);
  assert.equal(items.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0].error, /缺少名称/);
  assert.equal(issues[0].row, 2);
});

test("没有「名称」列时给出可操作的提示", () => {
  const { items, issues } = csvToItems("数量,单位\n3,罐");
  assert.equal(items.length, 0);
  assert.match(issues[0].error, /缺少「名称」列/);
});

test("日期多种写法都归一成 ISO", () => {
  const csv = [HEADER, "牛奶,1,盒,食品,消耗品,,100,2026.03.05,2026年4月9日,9,,"].join("\n");
  const { items } = csvToItems(csv);
  assert.equal(items[0].purchaseDate, "2026-03-05");
  assert.equal(items[0].expiryDate, "2026-04-09");
});

test("类型列兼容中英文,未知类型则不传", () => {
  const durable = csvToItems([HEADER, "电钻,1,台,家电,耐用品,,,,,300,,"].join("\n")).items[0];
  assert.equal(durable.type, "DURABLE");
  const unknown = csvToItems([HEADER, "杂物,1,件,其他,随便写,,,,,,,"].join("\n")).items[0];
  assert.equal(unknown.type, undefined);
});

test("超过上限时提示并停止", () => {
  const rows = [HEADER, ...Array.from({ length: 5 }, (_, index) => `物品${index},1,件,日用,消耗品,,,,,,,`)];
  const { items, issues } = csvToItems(rows.join("\n"), 3);
  assert.equal(items.length, 3);
  assert.match(issues[0].error, /一次最多导入 3 行/);
});

test("结果文案包含成功数与跳过原因", () => {
  assert.equal(importResultText(3, [], []), "已导入 3 件物品");
  const text = importResultText(2, [{ row: 4, error: "数量不是数字" }], [{ row: 2, error: "缺少名称" }]);
  assert.match(text, /已导入 2 件物品/);
  assert.match(text, /跳过 2 处/);
  assert.match(text, /第 2 行:缺少名称/);
  assert.equal(importResultText(0, [], []), "没有可导入的内容");
});