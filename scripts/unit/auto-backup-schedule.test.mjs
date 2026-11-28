// 「今天该不该自动备份」的单测。
//
// 由来(2026-11-29 实测代码):客户端把「今天已备份」的标记写在判断 response.ok **之前** ——
// 一次 500、或者会话过期(401)就会把今天标成已完成,这天再打开页面也不会重试,
// 家里当天就没有自动备份。提示会说(失败会 toast),但这一天的事实是没了。
//
// 所以这里钉住三件事:
//   1 只有成功才算「今天做完了」;
//   2 失败之后要**还能再试**,但不是每次翻页都试(有冷却);
//   3 标记格式要兼容旧版(旧值就是一个日期字符串),坏数据不许把今天永久卡死。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_BACKUP_RETRY_MS,
  EMPTY_MARKER,
  parseAutoBackupMarker,
  serializeAutoBackupMarker,
  shouldAttemptAutoBackup,
} from "../../src/lib/auto-backup-schedule.ts";

const DAY = "2026-11-29";
const NOON = new Date("2026-11-29T12:00:00").getTime();

test("标记:没有记录时该试", () => {
  assert.equal(shouldAttemptAutoBackup(EMPTY_MARKER, DAY, NOON), true);
});

test("标记:今天已经成功过,不再重复发", () => {
  const marker = { lastSuccessDate: DAY, lastFailureDate: null, lastFailureAt: null };
  assert.equal(shouldAttemptAutoBackup(marker, DAY, NOON), false);
});

test("标记:昨天成功过,今天照常要发", () => {
  const marker = { lastSuccessDate: "2026-11-28", lastFailureDate: null, lastFailureAt: null };
  assert.equal(shouldAttemptAutoBackup(marker, DAY, NOON), true);
});

test("失败之后必须还能再试(旧行为是当天再也不试)", () => {
  const failedNow = { lastSuccessDate: "2026-11-28", lastFailureDate: DAY, lastFailureAt: NOON };
  // 刚失败:先等一等,别每次翻页都弹提示
  assert.equal(shouldAttemptAutoBackup(failedNow, DAY, NOON), false);
  assert.equal(shouldAttemptAutoBackup(failedNow, DAY, NOON + 5 * 60 * 1000), false);
  // 差 1 毫秒也还不算到点
  assert.equal(shouldAttemptAutoBackup(failedNow, DAY, NOON + AUTO_BACKUP_RETRY_MS - 1), false);
  // 过了冷却(默认 30 分钟):必须再试
  assert.equal(shouldAttemptAutoBackup(failedNow, DAY, NOON + AUTO_BACKUP_RETRY_MS), true);
  assert.equal(shouldAttemptAutoBackup(failedNow, DAY, NOON + AUTO_BACKUP_RETRY_MS + 1), true);
});

test("失败发生在昨天:今天不受冷却影响(别把新的一天也拖住)", () => {
  const failedYesterday = { lastSuccessDate: "2026-11-27", lastFailureDate: "2026-11-28", lastFailureAt: new Date("2026-11-28T23:50:00").getTime() };
  assert.equal(shouldAttemptAutoBackup(failedYesterday, DAY, new Date("2026-11-29T00:05:00").getTime()), true);
});

test("失败时刻在「未来」(时钟被改过)时不许把今天永久卡死", () => {
  const futureFailure = { lastSuccessDate: null, lastFailureDate: DAY, lastFailureAt: NOON + 60 * 60 * 1000 };
  assert.equal(shouldAttemptAutoBackup(futureFailure, DAY, NOON), true);
});

test("标记解析:兼容旧版的一个日期字符串", () => {
  assert.deepEqual(parseAutoBackupMarker("2026-11-29"), { lastSuccessDate: "2026-11-29", lastFailureDate: null, lastFailureAt: null });
  // 旧值就是「今天已完成」→ 今天不该再发
  assert.equal(shouldAttemptAutoBackup(parseAutoBackupMarker("2026-11-29"), DAY, NOON), false);
  // 旧值是昨天 → 今天要发
  assert.equal(shouldAttemptAutoBackup(parseAutoBackupMarker("2026-11-28"), DAY, NOON), true);
});

test("标记解析:空值 / 坏数据一律当没有记录(宁可多试一次)", () => {
  for (const raw of [null, undefined, "", "   ", "{不是 JSON", "[]", '"2026-11-29"', "{}"]) {
    const marker = parseAutoBackupMarker(raw);
    assert.deepEqual(marker, EMPTY_MARKER, `不该把 ${String(raw)} 当成有效标记`);
    assert.equal(shouldAttemptAutoBackup(marker, DAY, NOON), true, `${String(raw)} 解析后应当还能再试`);
  }
});

test("标记解析:失败日期与失败时刻缺一半时,冷却不成立", () => {
  const halfA = parseAutoBackupMarker(JSON.stringify({ lastSuccessDate: "2026-11-28", lastFailureDate: DAY }));
  assert.deepEqual(halfA, { lastSuccessDate: "2026-11-28", lastFailureDate: null, lastFailureAt: null });
  assert.equal(shouldAttemptAutoBackup(halfA, DAY, NOON), true);

  const halfB = parseAutoBackupMarker(JSON.stringify({ lastFailureAt: NOON - 1000 }));
  assert.deepEqual(halfB, EMPTY_MARKER);
  assert.equal(shouldAttemptAutoBackup(halfB, DAY, NOON), true);
});

test("序列化再解析回来是同一份(写进 localStorage 的就是它)", () => {
  const marker = { lastSuccessDate: "2026-11-28", lastFailureDate: DAY, lastFailureAt: NOON };
  assert.deepEqual(parseAutoBackupMarker(serializeAutoBackupMarker(marker)), marker);
  // 成功之后清掉失败记录:不该留下「今天失败过」的残影
  const success = { lastSuccessDate: DAY, lastFailureDate: null, lastFailureAt: null };
  assert.deepEqual(parseAutoBackupMarker(serializeAutoBackupMarker(success)), success);
});