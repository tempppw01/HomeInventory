// 「最近用得多」榜单的单元测试:
//   npm run test:unit
//
// 守的是「同一件东西改个名就被算成两件」:流水的 itemName 是记录那一刻的名字快照
// (ActivityLog 留旧名是为了让历史说得清),但榜单问的是「这件东西用得多」。
// 探针库实测:同一件物品 6 次消耗(改名 A 前 3 次 + 改名 B 后 3 次),
// 旧实现按名字聚合成两行各 3 次 —— 真第一名(6 次)被 4 次的物品压在下面,
// 而且两行占掉 top-5 的两个名额,把本该上榜的挤了出去;改名后消耗次数不够多时,
// 旧名字那种「一行 1 次」还会直接从 top-5 里消失。
// 下面第 1 条用的就是那次实测的数据与顺序(dashboard 按 createdAt desc 喂进来)。
import { test } from "node:test";
import assert from "node:assert/strict";

import { CONSUMPTION_RANK_ROWS, rankConsumption } from "../../src/lib/consumption-ranking.ts";

const ITEM = "cmwzft4690005uakk7ilu0kfu";
const OTHER = "cmother00000000000000000";

/** 按时间倒序的流水(dashboard 的取法),时间只用来排序,取整秒便于断言。 */
function log(itemId, itemName, second) {
  return { itemId, itemName, createdAt: new Date(Date.UTC(2026, 10, 27, 12, 0, second)).toISOString() };
}

test("实测:改名前后各消耗 3 次的同一件物品,榜单上是一行 6 次", () => {
  const logs = [
    log(ITEM, "改名探针B", 54),
    log(ITEM, "改名探针B", 53),
    log(ITEM, "改名探针B", 52),
    log(ITEM, "改名探针A", 51),
    log(ITEM, "改名探针A", 50),
    log(ITEM, "改名探针A", 49),
    log(OTHER, "消耗链探针Czxpbs", 34),
    log(OTHER, "消耗链探针Czxpbs", 33),
    log(OTHER, "消耗链探针Czxpbs", 32),
    log(OTHER, "消耗链探针Czxpbs", 31),
  ];
  const rows = rankConsumption(logs, { nameById: new Map([[ITEM, "改名探针B"], [OTHER, "消耗链探针Czxpbs"]]) });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    itemId: ITEM,
    itemName: "改名探针B",
    count: 6,
    lastUsedAt: "2026-11-27T12:00:54.000Z",
  });
  // 4 次的那件排在它后面:名字不同而已,次数说话。
  assert.equal(rows[1].count, 4);
  // 榜上不留库存里已经不存在的老名字。
  assert.ok(!rows.some((row) => row.itemName === "改名探针A"));
});

test("改名后还没再消耗过:显示库存里的当前名字,不是最后一条流水里的旧名", () => {
  const rows = rankConsumption([log(ITEM, "旧名字", 10)], { nameById: new Map([[ITEM, "新名字"]]) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemName, "新名字");
});

test("物品被彻底删除(id 查不到当前名字)时保留流水里的名字,不显示成空白", () => {
  const rows = rankConsumption([log(ITEM, "已删除的旧物品", 10)], { nameById: new Map() });
  assert.equal(rows[0].itemName, "已删除的旧物品");
});

test("没有 itemId 的历史流水退回按名字聚合(迁移前的老记录)", () => {
  const rows = rankConsumption([log(null, "老流水物品", 10), log(null, "老流水物品", 9), log(null, "另一件老的", 8)]);
  assert.deepEqual(rows.map((row) => [row.itemName, row.count]), [["老流水物品", 2], ["另一件老的", 1]]);
});

test("两件真的同名的物品合成一行,列表里不会出现两行一样的名字", () => {
  const logs = [log(ITEM, "矿泉水", 10), log(OTHER, "矿泉水", 9)];
  const rows = rankConsumption(logs, { nameById: new Map([[ITEM, "矿泉水"], [OTHER, "矿泉水"]]) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
});

// 这条是「按 itemId 归并」唯一能过的形态:物品甲改名后,它的旧名字被物品乙用了。
// 按名字归并会把甲改名前的流水并进乙那行(时间还最新),于是乙凭空多出次数、
// 甲当前名字只剩改名后那几次 —— 两件物品的次数都算错了。
test("旧名字后来被另一件物品用了:两件物品的次数不能串在一起", () => {
  const logs = [
    log(OTHER, "矿泉水", 12), // 乙现在就叫矿泉水(更新)
    log(ITEM, "矿泉水", 11), // 甲改名前的旧流水
    log(ITEM, "矿泉水", 10),
  ];
  const rows = rankConsumption(logs, { nameById: new Map([[ITEM, "苏打水"], [OTHER, "矿泉水"]]) });
  assert.deepEqual(rows.map((row) => [row.itemName, row.count]), [["苏打水", 2], ["矿泉水", 1]]);
});

test("次数相同按最近一次使用排,再相同按码位定序(与运行时的 locale 无关)", () => {
  const rows = rankConsumption([log(OTHER, "乙", 6), log(ITEM, "甲", 5)], {});
  assert.deepEqual(rows.map((row) => row.itemName), ["乙", "甲"]);
  // 同一秒的两条(时间不分先后)按**码位**定序:「乙」(U+4E59) < 「甲」(U+7532)。
  // 这里特意不用 localeCompare —— 它不传 locale 时看运行时的默认 locale/ICU,实测同一条断言
  // 本机 Node 26 过、CI 的 Node 22 不过(v0.1.110 的 CI 就是这么红的,Release 也被拦下)。
  const tied = rankConsumption([log(ITEM, "乙", 5), log(OTHER, "甲", 5)], {});
  assert.deepEqual(tied.map((row) => row.itemName), ["乙", "甲"]);
});

test("名字为空的流水不计入(与旧行为一致)", () => {
  const rows = rankConsumption([log(ITEM, null, 10), log(ITEM, "有名字的", 9)], {});
  assert.deepEqual(rows.map((row) => row.itemName), ["有名字的"]);
});

test("合并之后再取前 N 名,合并不占用名额", () => {
  const logs = [
    log(ITEM, "改名前", 30),
    log(ITEM, "改名后", 29),
    log(ITEM, "改名后", 28),
    ...Array.from({ length: CONSUMPTION_RANK_ROWS }, (_, i) => log(`other-${i}`, `第${i}件`, i)),
  ];
  const rows = rankConsumption(logs, { nameById: new Map([[ITEM, "改名后"]]) });
  assert.equal(rows.length, CONSUMPTION_RANK_ROWS);
  assert.equal(rows[0].itemName, "改名后");
  assert.equal(rows[0].count, 3);
  // 合并后的那一行占 1 个名额,其余 4 个名额被 4 件各 1 次的占满(第 5 件进不来)。
  assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 3 + CONSUMPTION_RANK_ROWS - 1);
});
