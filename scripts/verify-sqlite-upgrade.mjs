// 容器升级路径:老版本建出来的 SQLite 库,被当前版本的 init-sqlite.ts 升级之后,还能不能用?
//
// 为什么值得单独守:
//   docker/entrypoint.sh 在 SQLite 模式下**每次启动都跑一遍** scripts/init-sqlite.ts。
//   用户升级镜像时,这个脚本就是在改他家里的真实数据库 —— 一旦它写错、漏列、或多改了数据,
//   用户看到的是「升级后东西没了 / 打不开了」。这条路径此前没有任何检查。
//
// 本轮实测到的问题(都已修):
//   1 老库缺 4 个索引(ActivityLog 的 itemId / memberId / createdAt、Item.deletedAt)——
//     它们只在 `prisma db push` 建出来的库里存在。修之前 `db push` 会**悄悄**再建这 4 个索引,
//     却只回一句「now in sync」。ActivityLog 是最大的表(实测本地 4 万行以上)。
//   2 老库缺 ActivityLog.userId / HouseholdMember.userId / Location.parentId 的**外键**
//     (SQLite 的 ALTER 加不了约束)。后果实测:删掉父空间后,子空间的 parentId 仍指着
//     已删除的行 —— 界面按 parentId 成树,那个子空间就无处挂靠,东西还在但看不到。
//     修法:新鲜库的建表语句带上外键;老库则用同样的语义「孤儿修复」把悬空引用置空。
//
// 用法:node scripts/verify-sqlite-upgrade.mjs
//   需要 git 历史里的旧标签(CI 里会先 fetch);取不到时明确 SKIP 并给出原因,不伪装成通过。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const OLD_TAG = process.env.OLD_TAG || "v0.1.56";
const DB_UPGRADE = "data/sqlite-upgrade.db";
const DB_ORPHAN = "data/sqlite-upgrade-orphan.db";
const OLD_SCRIPT = "output/init-sqlite-old-for-upgrade.ts";

const RESULTS = [];
const check = (name, ok, detail = "") => {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};
const skip = (name, why) => {
  RESULTS.push({ name, ok: true, skipped: true });
  console.log(`SKIP  ${name}  → ${why}`);
};

const removeDb = (file) => {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const path = file + suffix;
    if (existsSync(path)) { try { rmSync(path); } catch { /* 句柄未释放时忽略 */ } }
  }
};

const runScript = (file, dbFile) => execFileSync("npx", ["tsx", file], {
  encoding: "utf8",
  shell: true,
  env: { ...process.env, DATABASE_URL: `file:../${dbFile}` },
});

const open = (file) => new DatabaseSync(file);
const names = (db, sql, ...args) => db.prepare(sql).all(...args).map((row) => Object.values(row)[0]);
const scalar = (db, sql, ...args) => Object.values(db.prepare(sql).get(...args))[0];

/** 结构指纹:对象清单 + 每表列 + 每表外键(只比“集合”,不比 DDL 文本格式) */
const structureOf = (file) => {
  const db = open(file);
  try {
    const objects = names(db, "SELECT type || ':' || name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY 1");
    const tables = names(db, "SELECT name FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY 1");
    const detail = {};
    for (const table of tables) {
      detail[table] = {
        columns: names(db, `PRAGMA table_info("${table}")`).length ? db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name).sort() : [],
        foreignKeys: db.prepare(`PRAGMA foreign_key_list("${table}")`).all().map((row) => `${row.from}->${row.table}.${row.to}:${row.on_delete}`).sort(),
      };
    }
    return { objects, tables, detail };
  } finally {
    db.close();
  }
};

const seedOldData = (file) => {
  const db = open(file);
  try {
    const now = new Date().toISOString();
    db.exec("BEGIN");
    db.prepare(`INSERT INTO "User" (id,username,displayName,passwordHash,role,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)`).run("u1", "olduser", "老用户", "hash", "ADMIN", 1, now, now);
    db.prepare(`INSERT INTO "Location" (id,name,createdAt,updatedAt) VALUES (?,?,?,?)`).run("l1", "厨房", now, now);
    const item = db.prepare(`INSERT INTO "Item" (id,itemCode,name,quantity,unit,type,category,minQuantity,remainingPercent,expiryDate,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    item.run("i1", "INV-OLD-0001", "老抽", 1, "瓶", "CONSUMABLE", "调料", 1, 40, null, now, now);
    item.run("i2", "INV-OLD-0002", "卷纸", 2.5, "卷", "CONSUMABLE", "日用", 0, 100, null, now, now);
    item.run("i3", "INV-OLD-0003", "大米", 2.5, "kg", "CONSUMABLE", "食品", 0, 100, null, now, now);
    item.run("i4", "INV-OLD-0004", "吹风机", 0.4, "件", "DURABLE", "电器", 0, 100, "2027-01-01T00:00:00.000Z", now, now);
    db.prepare(`INSERT INTO "ShoppingItem" (id,name,quantity,unit,status,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)`).run("s1", "老抽", 2, "瓶", "PURCHASED", "manual", now, now);
    db.prepare(`INSERT INTO "ActivityLog" (id,action,itemId,itemName,detail,createdAt) VALUES (?,?,?,?,?,?)`).run("a1", "CONSUME", "i1", "老抽", "手动消耗 1 瓶", now);
    db.prepare(`INSERT INTO "PriceRecord" (id,itemName,category,unitPrice,quantity,totalPrice,purchasedAt,createdAt) VALUES (?,?,?,?,?,?,?,?)`).run("p1", "老抽", "调料", 9.9, 1, 9.9, now, now);
    db.prepare(`INSERT INTO "HouseholdTask" (id,title,dueAt,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run("t1", "换滤芯", now, now, now);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
};

const rowCounts = (file) => {
  const db = open(file);
  try {
    const out = {};
    for (const table of ["User", "Location", "Item", "ShoppingItem", "ActivityLog", "PriceRecord", "HouseholdTask"]) {
      out[table] = Number(scalar(db, `SELECT COUNT(*) FROM "${table}"`));
    }
    return out;
  } finally {
    db.close();
  }
};

// ---------- 0 准备 ----------
mkdirSync("data", { recursive: true });
mkdirSync("output", { recursive: true });
removeDb(DB_UPGRADE);
removeDb(DB_ORPHAN);

let oldScript = null;
try {
  oldScript = execFileSync("git", ["show", `${OLD_TAG}:scripts/init-sqlite.ts`], { encoding: "utf8" });
} catch {
  // 浅克隆里没有这个标签:下面会明确 SKIP 并说明怎么取,不伪装成通过。
  oldScript = null;
}
if (!oldScript || !oldScript.includes("CREATE TABLE")) {
  skip("从旧标签取建库脚本", `取不到 ${OLD_TAG}:scripts/init-sqlite.ts(浅克隆需要先 git fetch --depth 1 origin tag ${OLD_TAG})`);
  skip("老库升级后的完整检查", "没有旧版本建库脚本,无法构造真实的「老库」");
  console.log(`\n0/0 通过(全部跳过)`);
  process.exit(0);
}
check(`从旧标签(${OLD_TAG})取到建库脚本`, true, `${oldScript.split("\n").length} 行`);

writeFileSync(OLD_SCRIPT, oldScript);
runScript(OLD_SCRIPT, DB_UPGRADE);
runScript(OLD_SCRIPT, DB_ORPHAN);
seedOldData(DB_UPGRADE);
seedOldData(DB_ORPHAN);
const beforeCounts = rowCounts(DB_UPGRADE);
check("用旧版本脚本建出「老库」并塞入真实形状的数据", Object.values(beforeCounts).every((value) => value > 0), JSON.stringify(beforeCounts));

const oldStructure = structureOf(DB_UPGRADE);

// ---------- 1 升级(容器启动就是这么做的) ----------
let upgradeError = null;
try {
  runScript("scripts/init-sqlite.ts", DB_UPGRADE);
} catch (error) {
  upgradeError = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().split("\n").slice(-3).join(" ").slice(0, 300);
}
check("老库能被当前的 init-sqlite.ts 正常升级(不中断容器启动)", upgradeError === null, upgradeError ?? "");

const afterCounts = rowCounts(DB_UPGRADE);
check("升级后数据一行没少", JSON.stringify(afterCounts) === JSON.stringify(beforeCounts), `${JSON.stringify(beforeCounts)} → ${JSON.stringify(afterCounts)}`);

const upgraded = structureOf(DB_UPGRADE);
// 补齐:老库缺的表与列
const missingTables = ["AuditRecord", "SearchHistory"].filter((table) => !upgraded.tables.includes(table));
check("补齐了 AuditRecord / SearchHistory 两张表", missingTables.length === 0, `缺:${missingTables.join(", ")}`);
const needColumns = { ActivityLog: ["percentBefore", "percentAfter"], ShoppingItem: ["stockedAt", "stockedQuantity", "stockedItemId"] };
const missingColumns = [];
for (const [table, columns] of Object.entries(needColumns)) {
  const have = upgraded.detail[table]?.columns ?? [];
  for (const column of columns) if (!have.includes(column)) missingColumns.push(`${table}.${column}`);
}
check("补齐了余量标记与采购入库记账字段", missingColumns.length === 0, `缺:${missingColumns.join(", ")}`);

// 索引:这 4 个此前只在 db push 建出来的库里存在
const needIndexes = ["ActivityLog_itemId_idx", "ActivityLog_memberId_idx", "ActivityLog_createdAt_idx", "Item_deletedAt_idx"];
const missingIndexes = needIndexes.filter((index) => !upgraded.objects.includes(`index:${index}`));
check("补齐了只在 db push 里出现过的 4 个索引(ActivityLog 三个 + Item.deletedAt)", missingIndexes.length === 0, `缺:${missingIndexes.join(", ")}`);

// 结构变化必须**恰好**是「补表 + 补索引」:老库有的对象一个不能少,也不能多出别的东西。
const lostObjects = oldStructure.objects.filter((name) => !upgraded.objects.includes(name));
const expectedAdded = [
  "table:AuditRecord",
  "table:SearchHistory",
  ...needIndexes.map((index) => `index:${index}`),
  // v0.1.121 新增(离线待发队列的幂等凭据):升级路径会建它,参照清单也要跟着登记,
  // 否则这条检查会把「按设计补上的对象」报成「多出来的意外对象」。
  "table:SyncOperation",
  "index:SyncOperation_opId_key",
  "index:SyncOperation_createdAt_idx",
  // 两张新表各自带的索引(建表时一起建)
  "index:AuditRecord_finishedAt_idx",
  "index:SearchHistory_userId_idx",
  "index:SearchHistory_createdAt_idx",
];
const addedObjects = upgraded.objects.filter((name) => !oldStructure.objects.includes(name));
const unexpectedAdded = addedObjects.filter((name) => !expectedAdded.includes(name));
const notAdded = expectedAdded.filter((name) => !addedObjects.includes(name));
check(
  "升级只补了该补的东西(没有丢对象、也没有多出意外对象)",
  lostObjects.length === 0 && unexpectedAdded.length === 0 && notAdded.length === 0,
  `丢:${lostObjects.join(", ") || "无"} | 多:${unexpectedAdded.join(", ") || "无"} | 该补未补:${notAdded.join(", ") || "无"}`,
);

// db push 当裁判:升级后的库还缺什么?逐项比结构快照,而不是看它打印了什么。
const structureBeforePush = structureOf(DB_UPGRADE);
let pushError = null;
try {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"], {
    encoding: "utf8", shell: true, env: { ...process.env, DATABASE_URL: `file:../${DB_UPGRADE}` },
  });
} catch (error) {
  pushError = String(error.stdout ?? error.message).slice(0, 200);
}
const structureAfterPush = structureOf(DB_UPGRADE);
const pushAddedObjects = structureAfterPush.objects.filter((name) => !structureBeforePush.objects.includes(name));
const pushAddedColumns = [];
const pushAddedForeignKeys = [];
for (const table of structureAfterPush.tables) {
  const beforeColumns = structureBeforePush.detail[table]?.columns ?? [];
  for (const column of structureAfterPush.detail[table].columns) if (!beforeColumns.includes(column)) pushAddedColumns.push(`${table}.${column}`);
  const beforeFks = structureBeforePush.detail[table]?.foreignKeys ?? [];
  for (const fk of structureAfterPush.detail[table].foreignKeys) if (!beforeFks.includes(fk)) pushAddedForeignKeys.push(`${table}.${fk}`);
}
check("升级后的库不缺表 / 缺列 / 缺索引", pushError === null && pushAddedObjects.length === 0 && pushAddedColumns.length === 0, `${pushError ?? ""} 新增对象:${pushAddedObjects.join(", ") || "无"} 新增列:${pushAddedColumns.join(", ") || "无"}`);
// 外键是 SQLite 的硬限制:ALTER 加不了约束,只能重建表;行为上由「孤儿修复」兜住(见下)。
check("剩下的差异只有外键(SQLite 加不上,由孤儿修复兜住,不是漏)", pushAddedForeignKeys.length <= 3, `db push 补了 ${pushAddedForeignKeys.length} 个外键:${pushAddedForeignKeys.join("; ") || "无"}`);

// 幂等:容器每次重启都会跑一遍
const beforeSecondRun = rowCounts(DB_UPGRADE);
let secondRunError = null;
try { runScript("scripts/init-sqlite.ts", DB_UPGRADE); } catch (error) { secondRunError = String(error.message).slice(0, 160); }
const afterSecondRun = rowCounts(DB_UPGRADE);
check("再启动一次是幂等的(行数不变、不报错)", secondRunError === null && JSON.stringify(beforeSecondRun) === JSON.stringify(afterSecondRun), `${secondRunError ?? JSON.stringify(afterSecondRun)}`);

// ---------- 2 启动即改写的数据:按实测语义钉住 ----------
const valueOf = (file, id) => {
  const db = open(file);
  try {
    const row = db.prepare(`SELECT name, quantity, unit, type, expiryDate FROM "Item" WHERE id = ?`).get(id);
    return { quantity: Number(row.quantity), unit: row.unit, type: row.type, expiryDate: row.expiryDate };
  } finally {
    db.close();
  }
};
const oldSauce = valueOf(DB_UPGRADE, "i1");
check("老物品本身没被改写(老抽 1 瓶)", oldSauce.quantity === 1 && oldSauce.unit === "瓶", JSON.stringify(oldSauce));
const roll = valueOf(DB_UPGRADE, "i2");
check("计数单位的小数被取整(卷纸 2.5 卷 → 3 卷)", roll.quantity === 3, JSON.stringify(roll));
const rice = valueOf(DB_UPGRADE, "i3");
check("重量单位不动(大米 2.5 kg → 2.5 kg)", rice.quantity === 2.5, JSON.stringify(rice));
const dryer = valueOf(DB_UPGRADE, "i4");
check("计数单位不足 1 会被提到 1(吹风机 0.4 件 → 1 件,不会被清成 0)", dryer.quantity === 1, JSON.stringify(dryer));
check("耐用品不保留到期日(与接口里「耐用品不存保质期」一致)", dryer.expiryDate === null, JSON.stringify(dryer.expiryDate));

// ---------- 3 老库的外键补不回来,但孤儿引用要按同样的语义清掉 ----------
runScript("scripts/init-sqlite.ts", DB_ORPHAN);
{
  const db = open(DB_ORPHAN);
  try {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO "Location" (id,name,parentId,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run("orphan-child", "孤儿空间", "no-such-parent", now, now);
    db.prepare(`INSERT INTO "ActivityLog" (id,action,userId,itemName,createdAt) VALUES (?,?,?,?,?)`).run("orphan-log", "CONSUME", "no-such-user", "孤儿流水", now);
    db.prepare(`INSERT INTO "HouseholdMember" (id,name,userId,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run("orphan-member", "孤儿成员", "no-such-user", now, now);
  } finally {
    db.close();
  }
}
runScript("scripts/init-sqlite.ts", DB_ORPHAN);
{
  const db = open(DB_ORPHAN);
  try {
    const child = db.prepare(`SELECT parentId FROM "Location" WHERE id='orphan-child'`).get();
    const log = db.prepare(`SELECT userId FROM "ActivityLog" WHERE id='orphan-log'`).get();
    const member = db.prepare(`SELECT userId FROM "HouseholdMember" WHERE id='orphan-member'`).get();
    const keepChild = Number(scalar(db, `SELECT COUNT(*) FROM "Location" WHERE id='orphan-child'`)) === 1;
    check("孤儿空间被挂回顶级(parentId → NULL)而不是消失", child.parentId === null && keepChild, JSON.stringify(child));
    check("指向已删除账号的流水 userId 被置空", log.userId === null, JSON.stringify(log));
    check("指向已删除账号的成员 userId 被置空", member.userId === null, JSON.stringify(member));
  } finally {
    db.close();
  }
}

// ---------- 收尾 ----------
removeDb(DB_UPGRADE);
removeDb(DB_ORPHAN);
if (existsSync(OLD_SCRIPT)) rmSync(OLD_SCRIPT);
check("临时库与临时脚本已清理", !existsSync(DB_UPGRADE) && !existsSync(DB_ORPHAN), `${DB_UPGRADE} / ${DB_ORPHAN}`);

const failed = RESULTS.filter((entry) => !entry.ok);
const skipped = RESULTS.filter((entry) => entry.skipped);
console.log(`\n${RESULTS.length - failed.length - skipped.length}/${RESULTS.length - skipped.length} 通过${skipped.length ? `(${skipped.length} 项跳过)` : ""}`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);