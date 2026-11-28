// 离线快照文案的单测:
//   npm run test:unit
//
// 守的是「离线时用户唯一能判断数据新旧的这句话」。说轻了(3 分钟说成「刚刚」)
// 等于让人拿旧数字做决定;说重了(刚同步完却说「很久前」)会让人不敢用。
//
// 阶段 5 追加的红线:断网重开页面时,「上次同步」必须是**那份缓存真正从服务器下来的时刻**,
// 而不是「我打开页面的时刻」—— 后者会把旧数据说成新的,正是这个文件开头担心的事。
import { test } from "node:test";
import assert from "node:assert/strict";

import { CACHED_AT_HEADER, cachedAtFromHeaders, offlineSnapshotLabel, syncedAtFromResponse } from "../../src/lib/offline-snapshot.ts";

const NOW = new Date("2026-11-28T09:12:00");
const at = (minutesAgo, now = NOW) =>
  offlineSnapshotLabel(new Date(now.getTime() - minutesAgo * 60_000).toISOString(), now.getTime());

test("一分钟内说「刚刚同步的」,并给出同步时刻", () => {
  const result = at(0);
  assert.equal(result.ageText, "刚刚同步的");
  assert.equal(result.clock, "09:12");
});

test("过了几分钟就说清是几分钟前(不四舍五入成「刚刚」)", () => {
  assert.equal(at(3).ageText, "3 分钟前的");
  assert.equal(at(58).ageText, "58 分钟前的");
  assert.equal(at(59).ageText, "59 分钟前的");
});

test("满一小时就说小时,不再写「60 分钟前的」(阶段 5 修掉的分档)", () => {
  assert.equal(at(60).ageText, "1 小时前的");
  assert.equal(at(90).ageText, "1 小时前的");
  assert.equal(at(23 * 60 + 59).ageText, "23 小时前的");
});

test("过了 24 小时按自然日说「昨天的 / N 天前的」,再久直接给日期", () => {
  assert.equal(at(24 * 60).ageText, "昨天的");
  assert.equal(at(3 * 24 * 60).ageText, "3 天前的");
  assert.equal(at(6 * 24 * 60).ageText, "6 天前的");
  assert.equal(at(7 * 24 * 60).ageText, "11 月 21 日的");
});

test("跨天的快照连日期一起写,别让人把 3 天前的 23:30 当成今天的", () => {
  const result = offlineSnapshotLabel(new Date("2026-11-25T23:30:00").toISOString(), new Date("2026-11-28T09:12:00").getTime());
  assert.equal(result.ageText, "3 天前的");
  assert.equal(result.clock, "11-25 23:30");
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

test("响应头里的抓取戳读得到;在线直连(没这个头)或读不出来时给 null", () => {
  const stamp = "2026-11-28T06:33:53.630Z";
  assert.equal(cachedAtFromHeaders(new Headers({ [CACHED_AT_HEADER]: stamp })), stamp);
  assert.equal(cachedAtFromHeaders(new Headers({ [CACHED_AT_HEADER.toUpperCase()]: stamp })), stamp, "头名大小写不敏感");
  assert.equal(cachedAtFromHeaders(new Headers()), null, "在线直连:服务器不会打这个戳");
  assert.equal(cachedAtFromHeaders(new Headers({ [CACHED_AT_HEADER]: "not-a-date" })), null);
  assert.equal(cachedAtFromHeaders(null), null);
});

test("走缓存时记的是那份缓存的抓取时刻,不是「我打开页面的时刻」", () => {
  const stamp = "2026-11-28T06:33:53.630Z";
  const openedAt = new Date("2026-11-28T06:39:20.580Z");
  // 实测现场:缓存 06:33:53 拉的,06:39:20 断网重开 —— 记成 06:39:20 就等于把旧数据说成新的。
  assert.equal(syncedAtFromResponse(stamp, openedAt), stamp);
  assert.equal(syncedAtFromResponse(null, openedAt), openedAt.toISOString(), "在线直连才记现在");
  assert.equal(syncedAtFromResponse("", openedAt), openedAt.toISOString());
  assert.equal(syncedAtFromResponse("坏掉的戳", openedAt), openedAt.toISOString());
});
