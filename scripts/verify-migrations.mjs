// 迁移脚本的回归 —— 此前完全没有覆盖,而这两个脚本正是「老数据升级」要跑的。
//
//   npm run db:backfill  → 给没有编号的物品补 itemCode
//   npm run db:normalize → 清掉耐用品上不该有的到期日
//
// 为什么必须有:它们会**改写用户数据**,而且只在升级路径上跑,平时没人碰。
// 实测就抓到一个:backfill 的编号日期取的是 `createdAt.toISOString()`(**UTC 日**),
// 而在线路径 createItemCode 取的是本地日 —— 本地 2026-03-05 00:30 创建的物品会被写成
// INV-20260304-…,比创建日早一天,与新建物品的编号口径不一致。
//
// 这里钉住:格式、**日期取本地日**、重复跑幂等、normalize 只动耐用品、以及「在线新建的编号
// 与 backfill 补的编号用同一个日期口径」。
//
// 用法:DATABASE_URL=file:../data/ci.db node scripts/verify-migrations.mjs  (需要一个跑着的服务)

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

// 用 Prisma 直连(哪种库都行:SQLite 与 MySQL 都能跑同一套断言)
const prisma = new PrismaClient();
console.log(`      数据库:${(process.env.DATABASE_URL ?? "(未设置)").split("?")[0].replace(/:[^:@/]+@/, ":***@")}`);


const { loginCookie } = await import("./lib/probe-login.mjs");
const cookie = await loginCookie(BASE, USER, PASS);

const api = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
};

// ---------- 造「老数据」 ----------
const STAMP = Date.now().toString(36).slice(-5);
const makeItem = async (name, type, extra = {}) => {
  const created = await api("POST", "/api/items", {
    name, category: "其他", type, quantity: 1, unit: "个", minQuantity: 0, remainingPercent: 100, ...extra,
  });
  return created.json?.id ?? created.json?.item?.id ?? null;
};

const legacyId = await makeItem(`迁移探针·老数据${STAMP}`, "CONSUMABLE");
const durableId = await makeItem(`迁移探针·耐用品${STAMP}`, "DURABLE", { expiryDate: "2027-01-31" });
const consumableId = await makeItem(`迁移探针·消耗品${STAMP}`, "CONSUMABLE", { expiryDate: "2027-02-28" });
check("造出三件探针物品", Boolean(legacyId && durableId && consumableId), `${legacyId}/${durableId}/${consumableId}`);

// 把「老数据」那一件改成:没有编号 + 创建时间是本地 3 月 5 日凌晨(UTC 日还是 3 月 4 日)
const localEarlyMorning = new Date(2026, 2, 5, 0, 30, 0, 0);
await prisma.item.update({ where: { id: legacyId }, data: { itemCode: null, createdAt: localEarlyMorning } });
// 另外两件也清掉编号,确认脚本会给它们补上(而不是只处理边界那一件)
await prisma.item.updateMany({ where: { id: { in: [durableId, consumableId] } }, data: { itemCode: null } });
const readItem = (id) => prisma.item.findUnique({ where: { id }, select: { id: true, itemCode: true, type: true, expiryDate: true, createdAt: true } });

// ---------- 跑 backfill ----------
const runScript = (file) => execFileSync("npx", ["tsx", file], { encoding: "utf8", shell: true, env: process.env }).trim();

let output = "";
try {
  output = runScript("scripts/backfill-item-codes.ts");
  check("db:backfill 能跑通", true, "");
} catch (error) {
  check("db:backfill 能跑通", false, String(error).slice(0, 200));
}
console.log(`      脚本输出:${output}`);

const legacy = await readItem(legacyId);
check("老数据补上了编号", Boolean(legacy.itemCode), `itemCode=${legacy.itemCode ?? "(空)"}`);
check("编号格式是 INV-<8位日期>-<6位大写>", /^INV-\d{8}-[0-9A-F]{6}$/.test(String(legacy.itemCode ?? "")), `实际=${legacy.itemCode}`);

// **核心断言**:编号里的日期必须是本地创建日(2026-03-05),不是 UTC 日(2026-03-04)
const codeDate = String(legacy.itemCode ?? "").slice(4, 12);
check("编号里的日期取本地创建日(2026-03-05),不是 UTC 日(2026-03-04)", codeDate === "20260305", `编号=${legacy.itemCode} 日期段=${codeDate}`);

// ---------- 幂等 ----------
const beforeRerun = (await readItem(legacyId)).itemCode;
runScript("scripts/backfill-item-codes.ts");
const afterRerun = (await readItem(legacyId)).itemCode;
check("重复跑不会改已有编号(幂等)", beforeRerun === afterRerun, `${beforeRerun} → ${afterRerun}`);

// ---------- 与在线路径同一口径 ----------
const freshId = await makeItem(`迁移探针·新建${STAMP}`, "DURABLE");
const fresh = await readItem(freshId);
const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; })();
check("在线新建的编号同样用本地日(两条路径口径一致)", String(fresh.itemCode ?? "").slice(4, 12) === todayLocal, `编号=${fresh.itemCode} 期望日期段=${todayLocal}`);

// ---------- normalize:只动耐用品 ----------
let normalizeOutput = "";
try {
  normalizeOutput = runScript("scripts/normalize-items.ts");
  check("db:normalize 能跑通", true, "");
} catch (error) {
  check("db:normalize 能跑通", false, String(error).slice(0, 200));
}
console.log(`      脚本输出:${normalizeOutput}`);

const durableAfter = await readItem(durableId);
const consumableAfter = await readItem(consumableId);
check("耐用品上多余的到期日被清掉", durableAfter.expiryDate === null, `expiryDate=${durableAfter.expiryDate}`);
check("消耗品的到期日**不能**被清掉", Boolean(consumableAfter.expiryDate), `expiryDate=${consumableAfter.expiryDate}`);

// ---------- 收尾 ----------
for (const id of [legacyId, durableId, consumableId, freshId]) {
  if (id) await api("DELETE", `/api/items/${id}`, { permanent: true });
}
const leftovers = [];
for (const id of [legacyId, durableId, consumableId, freshId]) { if (id && (await readItem(id))) leftovers.push(id); }
check("探针数据已清理", leftovers.length === 0, `还剩:${leftovers.join(",")}`);

await prisma.$disconnect();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);