// 物品排序规则的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { sortItems, sortHint, isSortMode, SORT_MODES, SORT_LABELS } from "../../src/lib/item-sort.ts";

const item = (patch) => ({
  name: patch.name ?? "物品",
  quantity: patch.quantity ?? 1,
  expiryDate: patch.expiryDate ?? null,
  updatedAt: patch.updatedAt ?? null,
});

const ITEMS = [
  item({ name: "牛奶", quantity: 2, expiryDate: "2026-12-01" }),
  item({ name: "电钻", quantity: 1, expiryDate: null }),
  item({ name: "酸奶", quantity: 3, expiryDate: "2026-11-20" }),
  item({ name: "过期的饼干", quantity: 1, expiryDate: "2026-11-10" }),
];

test("默认顺序保持传入顺序", () => {
  assert.deepEqual(sortItems(ITEMS, "updated").map((row) => row.name), ITEMS.map((row) => row.name));
});

test("按到期排序:最早的在前,没有有效期的排最后", () => {
  const names = sortItems(ITEMS, "expiry").map((row) => row.name);
  assert.deepEqual(names, ["过期的饼干", "酸奶", "牛奶", "电钻"]);
});

test("按名称排序走拼音顺序(电 < 过 < 牛 < 酸)", () => {
  const names = sortItems(ITEMS, "name").map((row) => row.name);
  assert.deepEqual(names, ["电钻", "过期的饼干", "牛奶", "酸奶"]);
});

test("按数量排序:多的在前", () => {
  const names = sortItems(ITEMS, "quantity").map((row) => row.name);
  assert.equal(names[0], "酸奶");
  assert.equal(names[1], "牛奶");
});

test("排序不会改动原数组", () => {
  const before = ITEMS.map((row) => row.name);
  sortItems(ITEMS, "expiry");
  assert.deepEqual(ITEMS.map((row) => row.name), before);
});

test("相同排序键保持原顺序(稳定)", () => {
  const same = [item({ name: "a", expiryDate: "2026-12-01" }), item({ name: "b", expiryDate: "2026-12-01" })];
  assert.deepEqual(sortItems(same, "expiry").map((row) => row.name), ["a", "b"]);
});

test("到期提示会说清最快的一件还剩几天", () => {
  const now = new Date("2026-11-18T00:00:00").getTime();
  assert.match(sortHint("expiry", ITEMS, now), /已过期 \d+ 天/);
  assert.match(sortHint("expiry", [item({ name: "x", expiryDate: "2026-11-21" })], now), /还有 3 天到期/);
  assert.match(sortHint("expiry", [item({ name: "x", expiryDate: "2026-11-18" })], now), /今天到期/);
  assert.equal(sortHint("expiry", [item({ name: "x" })], now), "这些物品都没有填有效期");
  assert.equal(sortHint("name", ITEMS, now), null);
});

test("模式白名单与标签", () => {
  assert.equal(SORT_MODES.length, 4);
  for (const mode of SORT_MODES) {
    assert.ok(SORT_LABELS[mode.id], mode.id);
    assert.equal(isSortMode(mode.id), true);
  }
  assert.equal(isSortMode("bogus"), false);
  assert.equal(isSortMode(null), false);
});