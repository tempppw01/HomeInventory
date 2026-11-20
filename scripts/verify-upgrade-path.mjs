// 跨版本升级演练:旧库 → 跑一次文档里教的升级命令 → 数据不丢、新功能可用。
//
// 为什么需要:自托管用户是「拿新镜像盖旧的」,README 里教他们升级后跑
// `npx prisma db push`。这条路径此前**从没演练过** —— 而它一旦出问题,
// 用户丢的是家里的账本。
//
// 做法:
//   1. 从 git 历史里取出一个旧版本的 schema(默认 v0.0.7,那时还差 5 张表)
//   2. 用它建一个临时库,并塞进代表性的旧数据(物品、空间、采购项、活动日志)
//   3. 跑**当前** schema 的 db push(即文档里教的那一步)
//   4. 用当前的 Prisma Client 去读:老数据还在吗?新表能用吗?新字段能写吗?
//
// 没有 git 历史(例如浅克隆)时打印原因跳过,不伪装成通过。
//
// 用法:OLD_TAG=v0.0.7 node scripts/verify-upgrade-path.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const OLD_TAG = process.env.OLD_TAG || "v0.0.7";
const WORK_DIR = join(process.cwd(), "data", "upgrade-rehearsal");
const OLD_SCHEMA = join(WORK_DIR, "old-schema.prisma");
const DB_FILE = join(WORK_DIR, "old.db");
const DB_URL = `file:${DB_FILE.replace(/\\/g, "/")}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

/** 用当前 Prisma Client 连到指定库跑一段查询 */
const withClient = async (url, run) => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await run(client);
  } finally {
    await client.$disconnect();
  }
};

// ---------- 0. 准备:取旧 schema ----------
rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });

let oldSchemaText = null;
try {
  oldSchemaText = execFileSync("git", ["show", `${OLD_TAG}:prisma/schema.prisma`], { encoding: "utf8" });
} catch {
  console.log(`      跳过升级演练:取不到旧版本 schema(${OLD_TAG})—— 浅克隆里没有历史标签`);
  console.log("\n0/0 通过(已跳过)");
  process.exit(0);
}
writeFileSync(OLD_SCHEMA, oldSchemaText, "utf8");
console.log(`      使用 ${OLD_TAG} 的 schema(${oldSchemaText.split("\n").length} 行)`);

// ---------- 1. 用旧 schema 建库 ----------
// 直接调用本地 Prisma CLI:Windows 上 npx 是 npx.cmd,execFileSync 不走 shell 会找不到。
const PRISMA_CLI = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const runPrisma = (args) => execFileSync(process.execPath, [PRISMA_CLI, ...args], {
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: DB_URL },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  runPrisma(["db", "push", "--schema", OLD_SCHEMA, "--skip-generate"]);
  check("能用旧版本 schema 建出数据库", existsSync(DB_FILE), "临时库没建出来");
} catch (error) {
  check("能用旧版本 schema 建出数据库", false, error.message.slice(0, 160));
}

if (!results[0].ok) {
  rmSync(WORK_DIR, { recursive: true, force: true });
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 通过`);
  process.exit(1);
}

// ---------- 2. 塞进旧数据 ----------
const ITEM_NAME = "升级演练·旧数据物品";
const LOCATION_NAME = "升级演练·旧空间";
{
  const db = new DatabaseSync(DB_FILE);
  const nowIso = new Date().toISOString();

  /**
   * 按表的实际结构插入:旧版本的列名与 NOT NULL 约束不好靠猜
   * (第一次就先后撞上「没有 sortOrder 这一列」与「updatedAt 不能为空」)。
   * 这里读 PRAGMA,缺的 NOT NULL 列自动补一个按类型的合理值。
   */
  const insert = (table, values) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const row = { ...values };
    for (const column of columns) {
      if (row[column.name] !== undefined) continue;
      if (column.notnull === 1 && column.dflt_value === null) {
        row[column.name] = column.type.includes("INT") || column.type.includes("REAL") || column.type.includes("FLOAT") ? 0 : nowIso;
      }
    }
    const names = Object.keys(row);
    const placeholders = names.map(() => "?").join(", ");
    db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders})`).run(...names.map((name) => row[name]));
  };

  insert("Location", { id: "loc-old-1", name: LOCATION_NAME, icon: "Package", color: "#7c3aed", createdAt: nowIso, updatedAt: nowIso });
  insert("Item", {
    id: "item-old-1",
    itemCode: "INV-20260101-AAAAAA",
    name: ITEM_NAME,
    category: "日用",
    type: "CONSUMABLE",
    quantity: 7,
    minQuantity: 1,
    remainingPercent: 100,
    unit: "件",
    locationId: "loc-old-1",
    notes: "升级前就存在的一条备注",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  insert("ShoppingItem", { id: "shop-old-1", name: "升级演练·旧采购项", quantity: 2, unit: "件", category: "日用", priority: 2, source: "manual", status: "PENDING", createdAt: nowIso });
  insert("ActivityLog", { id: "log-old-1", action: "CREATE", itemId: "item-old-1", itemName: ITEM_NAME, detail: "升级前的记录", createdAt: nowIso });
  db.close();
  console.log("      已塞入旧数据:1 个空间 / 1 件物品 / 1 条采购项 / 1 条活动记录");
}

const beforeCounts = await withClient(DB_URL, async (client) => ({
  items: await client.item.count(),
  locations: await client.location.count(),
  shopping: await client.shoppingItem.count(),
  activities: await client.activityLog.count(),
}));
check("升级前数据就位", beforeCounts.items === 1 && beforeCounts.locations === 1 && beforeCounts.shopping === 1, JSON.stringify(beforeCounts));

// ---------- 3. 跑文档里教的那一步:当前 schema 的 db push ----------
{
  let ok = true;
  let detail = "";
  try {
    runPrisma(["db", "push", "--skip-generate"]);
  } catch (error) {
    ok = false;
    detail = (error.stdout || error.message || "").toString().slice(0, 200);
  }
  check("按文档执行 prisma db push 能升级旧库", ok, detail);
  if (!ok) {
    rmSync(WORK_DIR, { recursive: true, force: true });
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 通过`);
    process.exit(1);
  }
}

// ---------- 4. 用当前客户端验证:数据还在、新表能用、新字段能写 ----------
{
  const after = await withClient(DB_URL, async (client) => {
    const item = await client.item.findUnique({ where: { id: "item-old-1" } });
    const location = await client.location.findUnique({ where: { id: "loc-old-1" } });
    const shopping = await client.shoppingItem.findUnique({ where: { id: "shop-old-1" } });
    const activities = await client.activityLog.count();
    // 新表(旧库里没有)现在应当可用
    const audits = await client.auditRecord.count();
    const tasks = await client.householdTask.count();
    const history = await client.searchHistory.count();
    // 新字段(旧库里没有)应当能写能读
    const paused = await client.item.update({
      where: { id: "item-old-1" },
      data: { restockPausedUntil: new Date(Date.now() + 86400000) },
    });
    return { item, location, shopping, activities, audits, tasks, history, paused };
  });

  check("旧物品还在,且字段值不变", after.item?.name === ITEM_NAME && Number(after.item.quantity) === 7, `name=${after.item?.name} quantity=${after.item?.quantity}`);
  check("旧备注没丢", after.item?.notes === "升级前就存在的一条备注", `notes=${after.item?.notes}`);
  check("旧空间还在", after.location?.name === LOCATION_NAME, `name=${after.location?.name}`);
  check("旧采购项还在", after.shopping?.name === "升级演练·旧采购项", `name=${after.shopping?.name}`);
  check("旧活动记录还在", after.activities === 1, `count=${after.activities}`);
  check("新增的表可以正常查询(盘点 / 任务 / 搜索历史)", after.audits === 0 && after.tasks === 0 && after.history === 0, JSON.stringify({ audits: after.audits, tasks: after.tasks, history: after.history }));
  check("新增的字段可以写入(暂停补货提醒)", Boolean(after.paused?.restockPausedUntil), "写入后读不到");
}

rmSync(WORK_DIR, { recursive: true, force: true });

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);