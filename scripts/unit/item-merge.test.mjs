// 重复物品合并方案的单元测试:
//   npm run test:unit
// 合并是不可逆操作,所以这些断言等于「合并规则说明书」。
import { test } from "node:test";
import assert from "node:assert/strict";

import { planMerge } from "../../src/lib/item-merge.ts";

const base = {
  unit: "盒",
  quantity: 1,
  remainingPercent: 100,
  price: null,
  purchaseDate: null,
  expiryDate: null,
  notes: null,
  locationId: null,
};

test("数量相加,保留项与合并项一起算", () => {
  const plan = planMerge(
    { ...base, id: "a", name: "感冒药", quantity: 2 },
    [{ ...base, id: "b", name: "感冒药(盒装)", quantity: 3 }],
  );
  assert.equal(plan.merged.quantity, 5);
  assert.deepEqual(plan.removedIds, ["b"]);
  assert.match(plan.summary, /合计 5 盒/);
});

test("保质期取最早的一条(先过期的先吃掉)", () => {
  const plan = planMerge(
    { ...base, id: "a", name: "牛奶", expiryDate: "2027-01-10" },
    [{ ...base, id: "b", name: "牛奶", expiryDate: "2026-12-01" }],
  );
  assert.equal(new Date(plan.merged.expiryDate).toISOString().slice(0, 10), "2026-12-01");
});

test("液体余量取较低值,不高估", () => {
  const plan = planMerge(
    { ...base, id: "a", name: "洗洁精", unit: "瓶", remainingPercent: 80 },
    [{ ...base, id: "b", name: "洗洁精", unit: "瓶", remainingPercent: 30 }],
  );
  assert.equal(plan.merged.remainingPercent, 30);
});

test("单位不一致时拒绝合并,而不是算出一个错数", () => {
  const plan = planMerge({ ...base, id: "a", name: "可乐", unit: "罐" }, [{ ...base, id: "b", name: "可乐", unit: "瓶" }]);
  assert.ok("error" in plan);
  assert.match(plan.error, /单位不一致/);
});

test("备注去重后拼接,不丢信息", () => {
  const plan = planMerge(
    { ...base, id: "a", name: "纸巾", notes: "客厅用" },
    [{ ...base, id: "b", name: "纸巾", notes: "客厅用" }, { ...base, id: "c", name: "纸巾", notes: "厨房用" }],
  );
  assert.equal(plan.merged.notes, "客厅用\n厨房用");
  assert.equal(plan.removedIds.length, 2);
});

test("单价取第一个有效值;都没有则为 null", () => {
  const withPrice = planMerge({ ...base, id: "a", name: "洗衣液", price: null }, [{ ...base, id: "b", name: "洗衣液", price: 39.9 }]);
  assert.equal(withPrice.merged.price, 39.9);
  const noPrice = planMerge({ ...base, id: "a", name: "洗衣液" }, [{ ...base, id: "b", name: "洗衣液" }]);
  assert.equal(noPrice.merged.price, null);
});

test("存放位置沿用保留项,保留项没有才借合并项的", () => {
  const inherit = planMerge({ ...base, id: "a", name: "电池", locationId: "loc-1" }, [{ ...base, id: "b", name: "电池", locationId: "loc-2" }]);
  assert.equal(inherit.merged.locationId, "loc-1");
  const borrow = planMerge({ ...base, id: "a", name: "电池", locationId: null }, [{ ...base, id: "b", name: "电池", locationId: "loc-2" }]);
  assert.equal(borrow.merged.locationId, "loc-2");
});

test("购入日期取最早的一条", () => {
  const plan = planMerge(
    { ...base, id: "a", name: "咖啡", purchaseDate: "2026-05-01" },
    [{ ...base, id: "b", name: "咖啡", purchaseDate: "2026-03-01" }],
  );
  assert.equal(new Date(plan.merged.purchaseDate).toISOString().slice(0, 10), "2026-03-01");
});