// 离线快照文案的单测:
//   npm run test:unit
//
// 守的是「离线时用户唯一能判断数据新旧的这句话」。说轻了(3 分钟说成「刚刚」)
// 等于让人拿旧数字做决定;说重了(刚同步完却说「很久前」)会让人不敢用。
import { test } from "node:test";
import assert from "node:assert/strict";

import { offlineSnapshotLabel } from "../../src/lib/offline-snapshot.ts";

const at = (minutesAgo, now = new Date("2026-11-28T09:12:00")) =>
  offlineSnapshotLabel(new Date(now.getTime() - minutesAgo * 60_000).toISOString(), now.getTime());

test("一分钟内说「刚刚同步的」,并给出同步时刻", () => {
  const result = at(0);
  assert.equal(result.ageText, "刚刚同步的");
  assert.equal(result.clock, "09:12");
});

test("过了几分钟就说清是几分钟前(不四舍五入成「刚刚」)", () => {
  assert.equal(at(3).ageText, "3 分钟前的");
  assert.equal(at(59).ageText, "59 分钟前的");
  assert.equal(at(60).ageText, "60 分钟前的");
});

test("时刻补零,并且是按本地时间显示", () => {
  const result = offlineSnapshotLabel(new Date("2026-11-28T01:05:00").toISOString(), new Date("2026-11-28T01:05:30").getTime());
  assert.equal(result.clock, "01:05");
});

test("没有同步时间 / 时间串坏了:说「本地缓存的」,而且**不给时刻**", () => {
  assert.deepEqual(offlineSnapshotLabel(null), { ageText: "本地缓存的", clock: null });
  assert.deepEqual(offlineSnapshotLabel("不是时间"), { ageText: "本地缓存的", clock: null });
});

test("同步时间在未来(设备时钟被改过)时按「刚刚」算,不出现「-3 分钟前的」", () => {
  const now = new Date("2026-11-28T09:12:00").getTime();
  const result = offlineSnapshotLabel(new Date(now + 3 * 60_000).toISOString(), now);
  assert.equal(result.ageText, "刚刚同步的");
});
