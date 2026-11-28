// 自动备份文件名规则的单测。
//
// 由来(实测):文件名里没有库的标识,而一天只有一个名字 —— 同一台机器上跑第二份实例
// (探针库)且备份目录没分开时,后备份的那份会静默覆盖前一份。实测家庭库 2026-11-28 的
// 那份被探针库顶掉:文件里从「家庭库 9 件物品」变成「探针库 15 件『界面检查·…』」,
// 从文件名上完全看不出来。
//
// 所以这里把「今天该写哪个名字」与「哪些名字算合法备份」都钉住:
// 空位用朴素名 / 自己的文件可以覆盖 / **别人的(或来历不明的)文件一律另存,绝不覆盖**。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  autoBackupFileName,
  backupFileGroup,
  BACKUP_FILE_PATTERN,
  databaseFingerprint,
  isBackupFileName,
  readBackupOrigin,
} from "../../src/lib/backup-files.ts";

test("库指纹:6 位小写十六进制,同一份库稳定、不同库不同", () => {
  const home = databaseFingerprint("file:../data/home-inventory.db");
  const probe = databaseFingerprint("file:../data/probe-ci2.db");
  assert.match(home, /^[0-9a-f]{6}$/);
  assert.equal(home, databaseFingerprint("file:../data/home-inventory.db"));
  assert.notEqual(home, probe);
  // 没设 DATABASE_URL 也要有个确定的值(而不是抛错)
  assert.match(databaseFingerprint(undefined), /^[0-9a-f]{6}$/);
  assert.equal(databaseFingerprint(undefined), databaseFingerprint("(未设置)"));
});

test("文件名:空位用朴素名(与历史行为一致)", () => {
  assert.equal(autoBackupFileName("2026-11-28", "abc123", { exists: false, database: null }), "home-inventory-2026-11-28.json");
});

test("文件名:今天这份本来就是本库写的,还是朴素名(覆盖自己的没问题)", () => {
  assert.equal(autoBackupFileName("2026-11-28", "abc123", { exists: true, database: "abc123" }), "home-inventory-2026-11-28.json");
});

test("文件名:今天这份是别的库写的 → 带本库指纹另存,不覆盖别人的", () => {
  assert.equal(autoBackupFileName("2026-11-28", "abc123", { exists: true, database: "deadbe" }), "home-inventory-2026-11-28-abc123.json");
});

test("文件名:老备份(没有库指纹)当「不是本库的」→ 另存,不覆盖来历不明的文件", () => {
  assert.equal(autoBackupFileName("2026-11-28", "abc123", { exists: true, database: null }), "home-inventory-2026-11-28-abc123.json");
});

test("合法备份文件名:朴素名与带 6 位指纹的名字都认", () => {
  assert.equal(isBackupFileName("home-inventory-2026-11-28.json"), true);
  assert.equal(isBackupFileName("home-inventory-2026-11-28-abc123.json"), true);
  assert.equal(isBackupFileName("  home-inventory-2026-11-28-abc123.json  "), true);
  assert.equal(BACKUP_FILE_PATTERN.test("home-inventory-2026-11-28-abc12.json"), false, "5 位指纹不算");
  assert.equal(isBackupFileName("home-inventory-2026-11-28-ABC123.json"), false, "大写不算(指纹一律小写)");
});

test("合法备份文件名:依旧挡路径穿越与夹带", () => {
  for (const bad of [
    "../home-inventory.db",
    "home-inventory-2026-11-28.json/../x",
    "data/backups/home-inventory-2026-11-28.json",
    "home-inventory-2026-11-28.json.bak",
    "home-inventory-20261128.json",
    "home-inventory-2026-11-28-abc123.exe",
    "",
    null,
    42,
  ]) {
    assert.equal(isBackupFileName(bad), false, `不该通过:${String(bad)}`);
  }
});

test("分组:朴素名/老文件一组,带指纹的按指纹分组(各自的保留份数互不挤占)", () => {
  assert.equal(backupFileGroup("home-inventory-2026-11-28.json"), "");
  assert.equal(backupFileGroup("home-inventory-2026-11-28-abc123.json"), "abc123");
  assert.equal(backupFileGroup("home-inventory-2026-11-27-deadbe.json"), "deadbe");
});

test("读备份来源:文件不在 / 老文件 / 坏文件 / 字段类型不对,都不当成「本库的」", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "guiwu-backup-origin-"));
  try {
    const missing = await readBackupOrigin(path.join(dir, "nope.json"));
    assert.deepEqual(missing, { exists: false, database: null });

    const legacy = path.join(dir, "legacy.json");
    await writeFile(legacy, JSON.stringify({ version: 2, items: [] }), "utf8");
    assert.deepEqual(await readBackupOrigin(legacy), { exists: true, database: null });

    const stamped = path.join(dir, "stamped.json");
    await writeFile(stamped, JSON.stringify({ version: 2, items: [], database: "abc123" }), "utf8");
    assert.deepEqual(await readBackupOrigin(stamped), { exists: true, database: "abc123" });

    const broken = path.join(dir, "broken.json");
    await writeFile(broken, "{ 这不是 JSON", "utf8");
    assert.deepEqual(await readBackupOrigin(broken), { exists: true, database: null });

    const wrongType = path.join(dir, "wrong-type.json");
    await writeFile(wrongType, JSON.stringify({ database: 123 }), "utf8");
    assert.deepEqual(await readBackupOrigin(wrongType), { exists: true, database: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
