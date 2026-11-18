// 后台物品洞察规则引擎的单元测试:
//   npm run test:unit
// 这些断言同时充当「为什么建议冷藏」的说明书 —— 每条判定都要有依据可查。
// 注意:本文件是 .mjs(node 直接跑,不做类型擦除),不要写 TS 语法。
import { test } from "node:test";
import assert from "node:assert/strict";

import { storageAdviceFor, suggestedUnitFor, suggestedShelfLifeDays, autoTagsFor, itemInsight, STORAGE_LABEL } from "../../src/lib/item-insight.ts";

const drink = (name, category = "饮品") => ({ name, category, unit: "瓶", type: "CONSUMABLE" });

test("乳制品需要冷藏", () => {
  for (const name of ["巴氏鲜奶", "酸奶", "奶酪", "黄油"]) {
    assert.equal(storageAdviceFor(drink(name)).storage, "COLD", name);
  }
});

test("生鲜与熟食需要冷藏", () => {
  for (const name of ["三文鱼", "鸡胸肉", "卤味", "豆腐", "沙拉"]) {
    assert.equal(storageAdviceFor(drink(name, "食品")).storage, "COLD", name);
  }
});

test("胰岛素需要冷藏(药品里的冷链例外)", () => {
  const advice = storageAdviceFor({ name: "胰岛素注射液", category: "医药·慢病管理", unit: "支", type: "CONSUMABLE" });
  assert.equal(advice.storage, "COLD");
});

test("普通药品常温并说明原因", () => {
  const advice = storageAdviceFor({ name: "布洛芬缓释胶囊", category: "医药·疼痛炎症", unit: "盒", type: "CONSUMABLE" });
  assert.equal(advice.storage, "ROOM");
  assert.match(advice.storageReason, /常温|避光/);
});

test("碳酸饮料常温即可", () => {
  for (const name of ["可乐", "雪碧", "苏打水"]) {
    assert.equal(storageAdviceFor(drink(name)).storage, "ROOM", name);
  }
});

test("开封后冷藏的调味品不会误判为必须冷藏", () => {
  for (const name of ["酱油", "蚝油", "番茄酱", "果酱"]) {
    assert.equal(storageAdviceFor(drink(name, "调味")).storage, "COLD_AFTER_OPEN", name);
  }
});

test("未知饮料兜底为常温,不瞎建议冷藏", () => {
  const advice = storageAdviceFor(drink("某品牌新饮料"));
  assert.equal(advice.storage, "ROOM");
  assert.ok(advice.storageReason.length > 0);
});

test("存放建议都有可读的依据文案", () => {
  const cases = [drink("鲜奶"), drink("可乐"), drink("某饮料"), { name: "电钻", category: "家电", unit: "台", type: "DURABLE" }];
  for (const item of cases) {
    const advice = storageAdviceFor(item);
    assert.equal(typeof advice.storageReason, "string");
    assert.ok(advice.storageReason.length >= 6, `${item.name} 的依据太短`);
  }
});

test("饮料的建议单位:罐装/盒装/瓶装各自正确", () => {
  assert.equal(suggestedUnitFor("可口可乐罐装", "饮品"), "罐");
  assert.equal(suggestedUnitFor("维他奶纸盒", "饮品"), "盒");
  assert.equal(suggestedUnitFor("农夫山泉", "饮品"), "瓶");
  assert.equal(suggestedUnitFor("酸奶", "饮品"), "盒");
  assert.equal(suggestedUnitFor("巴氏鲜奶", "饮品"), "盒");
  assert.equal(suggestedUnitFor("电钻", "家电"), undefined);
});

test("常见饮食的建议保质期", () => {
  assert.equal(suggestedShelfLifeDays("巴氏鲜奶"), 7);
  assert.equal(suggestedShelfLifeDays("酸奶"), 21);
  assert.equal(suggestedShelfLifeDays("啤酒"), 180);
  assert.equal(suggestedShelfLifeDays("电钻"), undefined);
});

test("自动标签覆盖饮料/碳酸/乳制品/酒精/冷藏", () => {
  assert.ok(autoTagsFor(drink("可口可乐罐装")).includes("碳酸"));
  assert.ok(autoTagsFor(drink("酸奶")).includes("乳制品"));
  assert.ok(autoTagsFor(drink("酸奶")).includes("需冷藏"));
  assert.ok(autoTagsFor(drink("青岛啤酒")).includes("酒精"));
  assert.ok(autoTagsFor(drink("酱油", "调味")).includes("开封后冷藏"));
});

test("耐用品不会被打上需冷藏", () => {
  const tags = autoTagsFor({ name: "电钻", category: "家电", unit: "台", type: "DURABLE" });
  assert.equal(tags.includes("需冷藏"), false);
  assert.ok(tags.includes("耐用品"));
});

test("一次性返回完整洞察", () => {
  const insight = itemInsight(drink("巴氏鲜奶"));
  assert.equal(insight.storage, "COLD");
  assert.equal(insight.suggestedUnit, "盒");
  assert.equal(insight.suggestedShelfLifeDays, 7);
  assert.ok(insight.tags.length > 0);
});

test("三种存放状态都有中文标签", () => {
  for (const key of ["COLD", "COLD_AFTER_OPEN", "ROOM"]) {
    assert.ok(STORAGE_LABEL[key].length > 0, key);
  }
});