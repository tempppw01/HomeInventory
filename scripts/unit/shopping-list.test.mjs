// 「在不在采购清单里」与「常买」的单测:
//   npm run test:unit
//
// 这个文件钉住的两件事,都是 2026-11-27 在真界面上量出来的:
//   · 概览的「补货建议」按名字排除已在清单的物品,首屏却不看 —— 同一件东西一处说不加、一处请你加,
//     点一次清单上的数量就翻倍(4 盒 → 8 盒)。
//   · ★ 说「已加入常买清单」,但没有任何一栏列出常买;买过的采购项从待购列表消失后,标记就找不到了。
import { test } from "node:test";
import assert from "node:assert/strict";

import { boughtFavoritePurchases, findPendingPurchase, isPendingPurchase, normalizedPurchaseName, pendingPurchaseKey } from "../../src/lib/shopping-list.ts";

const row = (patch) => ({
  name: patch.name ?? "牛奶",
  unit: patch.unit ?? "瓶",
  quantity: patch.quantity ?? 1,
  status: patch.status ?? "PENDING",
  isFavorite: patch.isFavorite ?? false,
});

test("名字归一:去空白 + 忽略大小写", () => {
  assert.equal(normalizedPurchaseName("  鲜 奶  "), "鲜奶");
  assert.equal(normalizedPurchaseName("Milk"), normalizedPurchaseName(" m ilk "));
});

test("已在清单只认「名字 + 单位」:单位不同不算", () => {
  const rows = [row({ name: "牛奶", unit: "盒" })];
  assert.equal(isPendingPurchase(rows, "牛奶", "盒"), true);
  assert.equal(isPendingPurchase(rows, "牛奶", "瓶"), false);
  assert.equal(isPendingPurchase(rows, " 牛 奶 ", "盒"), true);
  assert.notEqual(pendingPurchaseKey("牛奶", "盒"), pendingPurchaseKey("牛奶", "瓶"));
});

test("已购买的不算「还在清单里」", () => {
  const rows = [row({ name: "牛奶", status: "PURCHASED" })];
  assert.equal(isPendingPurchase(rows, "牛奶", "瓶"), false);
  assert.equal(findPendingPurchase(rows, "牛奶", "瓶"), null);
});

test("交出清单里那一条,界面才能照实说「已经有一份 4 瓶」", () => {
  const rows = [row({ name: "牛奶", quantity: 4 }), row({ name: "抽取式厨房纸", unit: "包" })];
  const found = findPendingPurchase(rows, "牛奶", "瓶");
  assert.equal(found?.quantity, 4);
  assert.equal(found?.unit, "瓶");
});

test("常买且买过的那几条才交给「常买」那一栏", () => {
  const rows = [
    row({ name: "常买·待购中", isFavorite: true }),
    row({ name: "常买·已买到", isFavorite: true, status: "PURCHASED" }),
    row({ name: "买过但没标常买", isFavorite: false, status: "PURCHASED" }),
    row({ name: "普通待购" }),
  ];
  assert.deepEqual(boughtFavoritePurchases(rows).map((entry) => entry.name), ["常买·已买到"]);
});

test("空清单问什么都没事", () => {
  assert.equal(isPendingPurchase([], "牛奶", "瓶"), false);
  assert.equal(findPendingPurchase([], "牛奶", "瓶"), null);
  assert.deepEqual(boughtFavoritePurchases([]), []);
});
