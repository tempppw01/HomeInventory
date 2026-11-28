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
  collectFileOrigins,
  databaseFingerprint,
  isBackupFileName,
  readBackupOrigin,
  readBackupTailOrigin,
  resolveBackupFingerprint,
} from "../../src/lib/backup-files.ts";
import { backupFileDate, backupFileFingerprint, backupFileOptionLabel, backupFileSourceFingerprint } from "../../src/lib/backup-label.ts";

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

// ---------- 界面下拉那一行显示成什么 ----------
// 文件名里的 6 位是唯一能区分「谁写的」的东西,但直接摆给用户看不懂
// (家庭库那份被探针库顶掉时,界面上就是一条看着像随机后缀的名字)。

test("下拉文案:本机那份写「本机」,另一份库那份把指纹写出来", () => {
  assert.equal(backupFileOptionLabel("home-inventory-2026-11-28-8a4396.json", "8a4396", "8a4396"), "2026-11-28 · 本机");
  assert.equal(backupFileOptionLabel("home-inventory-2026-11-28-c387a3.json", "c387a3", "8a4396"), "2026-11-28 · 另一份库(c387a3)");
  // 名字里没有、内容里也没有 → 只能老实说「未标明来源」
  assert.equal(backupFileOptionLabel("home-inventory-2026-11-27.json", null, "8a4396"), "2026-11-27 · 未标明来源");
});

test("库指纹的来源:文件名优先,没有就用服务端从内容里认出来的那个", () => {
  const origins = { "home-inventory-2026-11-28.json": "26efcf" };
  // 实测场景:先写的那份占着朴素名,名字上什么都没写,内容里是别的库 → 不能被标成「未标明来源」
  assert.equal(backupFileSourceFingerprint("home-inventory-2026-11-28.json", origins), "26efcf");
  assert.equal(
    backupFileOptionLabel("home-inventory-2026-11-28.json", backupFileSourceFingerprint("home-inventory-2026-11-28.json", origins), "8a4396"),
    "2026-11-28 · 另一份库(26efcf)",
  );
  // 名字里有指纹时不必再看内容(内容那份可能是空的/没读过)
  assert.equal(backupFileSourceFingerprint("home-inventory-2026-11-27-abc123.json", origins), "abc123");
  // 没有 fileOrigins(老接口/读不到)也不能炸
  assert.equal(backupFileSourceFingerprint("home-inventory-2026-11-27.json", undefined), null);
});

test("只读文件末尾也能认出是谁写的(升级前的老备份认不出来 → null)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "guiwu-backup-tail-"));
  try {
    // 136 起的落盘格式:`database` 是最后一个键(JSON.stringify({...payload, database}, null, 2))
    const stamped = path.join(dir, "home-inventory-2026-11-28.json");
    await writeFile(stamped, JSON.stringify({ version: 2, exportedAt: "2026-11-28T00:00:00.000Z", items: [{ name: "布洛芬缓释胶囊" }], database: "26efcf" }, null, 2), "utf8");
    assert.equal(await readBackupTailOrigin(stamped), "26efcf");
    assert.equal(await resolveBackupFingerprint(stamped, "home-inventory-2026-11-28.json"), "26efcf");

    // 老备份:尾巴上只有 `]` 和 `}`,没有 database 字段
    const legacy = path.join(dir, "home-inventory-2026-11-27.json");
    await writeFile(legacy, JSON.stringify({ version: 2, exportedAt: "2026-11-27T00:00:00.000Z", items: [{ name: "青岛啤酒" }] }, null, 2), "utf8");
    assert.equal(await readBackupTailOrigin(legacy), null);

    // 名字里已经带指纹的,不去读内容也能认出来(collectFileOrigins 只处理没后缀的)
    const origins = await collectFileOrigins(["home-inventory-2026-11-27-abc123.json", "home-inventory-2026-11-28.json", "home-inventory-2026-11-27.json"], dir);
    assert.deepEqual(origins, { "home-inventory-2026-11-28.json": "26efcf", "home-inventory-2026-11-27.json": null });

    // 文件不在(或读不动)时给 null,而不是抛
    assert.equal(await readBackupTailOrigin(path.join(dir, "不存在的文件.json")), null);
    assert.equal(await readBackupTailOrigin(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("下拉文案:认不出的名字也好过编一个", () => {
  assert.equal(backupFileOptionLabel("奇怪的名字.json", null, "8a4396"), "奇怪的名字.json · 未标明来源");
  assert.equal(backupFileDate("home-inventory-2026-11-28.json"), "2026-11-28");
  assert.equal(backupFileFingerprint("home-inventory-2026-11-28.json"), null);
  assert.equal(backupFileFingerprint("home-inventory-2026-11-28-8a4396.json"), "8a4396");
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
