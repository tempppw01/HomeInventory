// 全新 SQLite 部署是否真的能用(不需要起服务)。
//
// 由来 —— 这一轮被 docker-publish 的冒烟测试抓到、随后在本地复现的缺陷:
//
//   `scripts/init-sqlite.ts` 是**全新 SQLite 部署真正用的表结构**(docker/entrypoint.sh 在
//   SQLite 模式下跑的就是它;MySQL 模式才用 prisma db push)。这份手写 SQL 没人对着
//   schema.prisma 校过,于是它悄悄落后了:
//
//     · 缺 `AuditRecord` / `SearchHistory` 两张表 → 全新部署上「盘点历史」「搜索历史」
//       从第一次使用起就一直 503;
//     · 缺 `ShoppingItem.stockedAt/stockedQuantity/stockedItemId`(v0.1.56 加的)
//       → 「标记已购买 → 入库 / 撤销退回」503;
//     · 缺 `ActivityLog.percentBefore/percentAfter`(v0.1.57 加的)
//       → **容器第一次启动就挂**:POST /api/auth/setup 建管理员要写一条 ActivityLog,
//         而那个接口当时连 try/catch 都没有,回的是**空白 500**。
//
// 两个守卫分工:scripts/unit/init-sqlite-drift.test.mjs 静态比对文本(快,不需要跑 SQL);
// 这个套件**真的把 SQL 跑一遍**建一个临时库,再逐表逐列核对,并真的写一遍那几张表 ——
// 手写 SQL 里的拼写错误、类型不匹配这类「文本看起来对、跑起来不对」的问题只有这里能抓到。
//
// 用法:node scripts/verify-sqlite-init.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const DB_FILE = "data/sqlite-init-check.db";
const RESULTS = [];
const check = (name, ok, detail = "") => {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cleanup = () => {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = DB_FILE + suffix;
    if (existsSync(file)) { try { rmSync(file); } catch { /* 忽略:进程可能还握着句柄 */ } }
  }
};

cleanup();

/** schema.prisma 的 { 模型名: [非关系字段...] } —— 与单测里的解析口径一致 */
function parsePrisma(file) {
  const models = {};
  let current = null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const header = line.match(/^model (\w+)/);
    if (header) { current = header[1]; models[current] = []; continue; }
    if (current === null) continue;
    if (line.startsWith("}")) { current = null; continue; }
    if (!/^\s{2}\w+\s/.test(line)) continue;
    const [name, type] = line.trim().split(/\s+/);
    if (name.startsWith("@")) continue;
    models[current].push({ name, type });
  }
  const modelNames = new Set(Object.keys(models));
  const out = {};
  for (const [model, fields] of Object.entries(models)) {
    out[model] = fields.filter((field) => !modelNames.has(field.type.replace(/[?[\]]/g, ""))).map((field) => field.name);
  }
  return out;
}

const expected = parsePrisma("prisma/schema.prisma");
check("解析出了足够多的模型(防止空跑)", Object.keys(expected).length > 10, `${Object.keys(expected).length} 个`);
check("解析出了足够多的字段(防止空跑)", Object.values(expected).flat().length > 100, `${Object.values(expected).flat().length} 个字段`);

// ---------- 真的建一次库 ----------
let built = false;
try {
  execFileSync("npx", ["tsx", "scripts/init-sqlite.ts"], {
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATABASE_URL: `file:../${DB_FILE}` },
  });
  built = existsSync(DB_FILE);
} catch (error) {
  check("用 init-sqlite.ts 建出一个临时库", false, String(error.stdout ?? error.message).slice(-300));
}
check("用 init-sqlite.ts 建出一个临时库", built, `找不到 ${DB_FILE}`);

if (built) {
  const prisma = new PrismaClient({ datasources: { db: { url: `file:../${DB_FILE}` } } });
  try {
    const missingTables = [];
    const missingColumns = [];
    for (const [model, fields] of Object.entries(expected)) {
      const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${model}")`);
      if (!rows.length) { missingTables.push(model); continue; }
      const columns = rows.map((row) => row.name);
      for (const field of fields) if (!columns.includes(field)) missingColumns.push(`${model}.${field}`);
    }
    check("新建的库不缺表", missingTables.length === 0, `缺:${missingTables.join(", ")}`);
    check("新建的库不缺字段", missingColumns.length === 0, `缺:${missingColumns.join(", ")}`);

    // 真的写一遍「全新部署第一次会写的几行」——列名/类型不对时这里就会炸。
    const writes = [];
    let writeError = null;
    try {
      const user = await prisma.user.create({ data: { username: "initcheck", displayName: "全新库检查", passwordHash: "x", role: "ADMIN" } });
      writes.push("User");
      await prisma.householdMember.create({ data: { name: "全新库检查", userId: user.id } });
      writes.push("HouseholdMember");
      await prisma.activityLog.create({ data: { action: "ACCOUNT_SETUP", userId: user.id, detail: "初始化管理员账号" } });
      writes.push("ActivityLog");
      await prisma.activityLog.create({ data: { action: "CONSUME", itemName: "液体探针", detail: "余量 100% → 60%", percentBefore: 100, percentAfter: 60 } });
      writes.push("ActivityLog.percentBefore/After");
      const item = await prisma.item.create({ data: { name: "全新库探针物品", category: "食品", type: "CONSUMABLE", quantity: 3, unit: "盒" } });
      writes.push("Item");
      await prisma.shoppingItem.create({ data: { name: "全新库探针采购", quantity: 2, unit: "盒", stockedAt: new Date(), stockedQuantity: 2, stockedItemId: item.id } });
      writes.push("ShoppingItem.stocked*");
      await prisma.auditRecord.create({ data: { userId: user.id, total: 3, confirmed: 2, locationName: "厨房" } });
      writes.push("AuditRecord");
      await prisma.searchHistory.create({ data: { query: "牛奶", userId: user.id } });
      writes.push("SearchHistory");
    } catch (error) {
      writeError = `${writes.join(" → ") || "(第一步就失败)"} | ${String(error.message).split("\n").slice(-3).join(" ").slice(0, 300)}`;
    }
    await prisma.$disconnect().catch(() => undefined);
    check("新建的库能真的写进这些表(建管理员 / 余量消耗 / 采购入库 / 盘点 / 搜索历史)", writeError === null && writes.length === 8, writeError ?? `${writes.length} 步:${writes.join(" → ")}`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

cleanup();
check("临时库已清理", !existsSync(DB_FILE), `${DB_FILE} 还在`);

const failed = RESULTS.filter((entry) => !entry.ok);
console.log(`\n${RESULTS.length - failed.length}/${RESULTS.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);
