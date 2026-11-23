// duplicateGroups 的单测。
//
// 这个函数在概览页每次渲染都跑一遍,而它原来是**两两比对**:
// 10k 个不同名字 ≈ 1 亿次 includes(),实测 2.5k=13ms、5k=48ms、10k=188~260ms(每翻一倍涨四倍)。
// 现在改成「枚举每个名字的长度 ≥3 子串并查表」,判定条件与原来一致。
//
// 所以这里最重要的一条不是「能分组」,而是**与旧实现逐个字段等价** ——
// 把旧实现原样留在测试里当参照物,拿随机语料对拍。分组顺序、key、keepId 都要求一致,
// 否则概览页上「保留哪一件」会悄悄变掉。

import { test } from "node:test";
import assert from "node:assert/strict";

import { duplicateGroups, normalizeItemName } from "../../src/lib/item-forecast.ts";

/** 旧实现(两两比对)—— 只作为对照,不要在生产代码里复活它。
 *  归一化必须用**库里那一个**:它会把「1L」「500ml」这类数字+单位整个去掉,
 *  名字归一化后为空就不参与分组 —— 测试自己抄一份简化版就会显得两版不一致。 */
function duplicateGroupsReference(items) {
  const normalize = (name) => normalizeItemName(name);
  const buckets = new Map();
  for (const item of items) {
    const key = normalize(item.name);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const keys = [...buckets.keys()].sort((left, right) => left.length - right.length);
  for (const shorter of keys) {
    if (shorter.length < 3 || !buckets.has(shorter)) continue;
    for (const longer of keys) {
      if (longer === shorter || longer.length <= shorter.length) continue;
      if (!longer.includes(shorter) || !buckets.has(longer)) continue;
      buckets.set(shorter, [...(buckets.get(shorter) ?? []), ...(buckets.get(longer) ?? [])]);
      buckets.delete(longer);
    }
  }
  const groups = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length > 1) {
      const sorted = [...bucket].sort((left, right) => right.quantity - left.quantity);
      groups.push({ key, items: sorted.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit })), keepId: sorted[0].id });
    }
  }
  return groups.sort((left, right) => right.items.length - left.items.length);
}

const row = (id, name, quantity = 1) => ({ id, name, category: "食品", type: "CONSUMABLE", unit: "件", quantity, remainingPercent: 100, consumeRate: null });

test("同一个名字合并成一组,按数量多的留作主件", () => {
  const groups = duplicateGroups([row("a", "洗洁精", 1), row("b", "洗洁精", 5), row("c", "牙膏", 2)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keepId, "b");
  assert.deepEqual(groups[0].items.map((item) => item.id), ["b", "a"]);
});

test("较短的名字被较长名字包含时并组(规格 / 口味)", () => {
  const groups = duplicateGroups([row("a", "洗洁精"), row("b", "洗洁精柠檬"), row("c", "洗洁精 柠檬味")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "洗洁精");
  assert.equal(groups[0].items.length, 3);
});

test("两字以内的通用词不参与包含合并", () => {
  assert.equal(duplicateGroups([row("a", "盐"), row("b", "盐焗花生")]).length, 0);
});

test("与旧实现完全等价(随机语料对拍)", () => {
  const fragments = ["洗洁精", "柠檬", "牛奶", "脱脂", "洗衣液", "补充装", "牙膏", "盐", "米", "酱油", "1L", "500ml"];
  // 固定种子的伪随机,失败可复现
  let seed = 20261123;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  for (let round = 0; round < 40; round += 1) {
    const items = Array.from({ length: 1 + Math.floor(random() * 18) }, (_, index) => {
      const parts = Array.from({ length: 1 + Math.floor(random() * 2) }, () => fragments[Math.floor(random() * fragments.length)]);
      const separator = random() < 0.3 ? " " : "";
      return row(`id-${round}-${index}`, parts.join(separator), 1 + Math.floor(random() * 9));
    });
    assert.deepEqual(duplicateGroups(items), duplicateGroupsReference(items), `第 ${round} 轮语料:${JSON.stringify(items.map((item) => item.name))}`);
  }
});

test("上万条不同名字也要在预算内跑完(挡住 O(n²) 回潮)", () => {
  // 10k 条两两比对约 1 亿次字符串搜索,实测 188~260ms;现在应当在几十毫秒内
  const items = Array.from({ length: 10000 }, (_, index) => row(`id-${index}`, `备品 ${String(index).padStart(5, "0")}`));
  const began = performance.now();
  const groups = duplicateGroups(items);
  const ms = performance.now() - began;
  assert.equal(groups.length, 0, "这批名字互不包含,不该分组");
  assert.ok(ms < 120, `10k 条用了 ${ms.toFixed(1)}ms,超过预算 120ms`);
});

test("上万条**确实有**包含关系时也跑得动,且结果正确", () => {
  // 让每个名字都是「洗洁精 + 序号」,彼此不包含;再插入若干真包含对
  const items = Array.from({ length: 8000 }, (_, index) => row(`n-${index}`, `备品 ${String(index).padStart(5, "0")}`));
  items.push(row("x1", "洗洁精"), row("x2", "洗洁精柠檬"), row("x3", "洗洁精柠檬味"));
  const began = performance.now();
  const groups = duplicateGroups(items);
  const ms = performance.now() - began;
  const group = groups.find((entry) => entry.key === "洗洁精");
  assert.ok(group, "应当合并出「洗洁精」这一组");
  assert.equal(group.items.length, 3);
  assert.ok(ms < 150, `8003 条用了 ${ms.toFixed(1)}ms,超过预算 150ms`);
});