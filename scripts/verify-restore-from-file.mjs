// 「从服务器上的备份恢复」与「超过上限时不许谎报文件坏了」的验收。
//
// 由来(实测):一份 70.17 MB 的备份 POST 给 /api/backup/restore,拿到的是
// **HTTP 400「请求内容不是合法的 JSON」** —— 请求体在解析前就被 64 MB 的上限截断了,
// 而 apiError 把 SyntaxError 翻成了那句话。文件明明完全合法,用户会以为备份坏了;
// 而且**超过上限的备份当时没有任何恢复路径**(界面预检直接拒绝上传)。
//
// 现在:
//   · 超限请求体 → 413 + 「这个备份文件 X MB 超过了服务端上限 64.0 MB…」,不再谎报 JSON 坏了;
//   · 新增 `{ fromFile: "home-inventory-YYYY-MM-DD.json" }`:服务器读自己磁盘上那份自动备份,
//     完全不经过上传,所以多大都能恢复;文件名受白名单正则约束,天然挡路径穿越。
//
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-restore-from-file.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
// 只读账号:与其它套件统一用 PROBE_VIEWER_USER/PASS(已在配置文档白名单里),
// 不要再造新的环境变量名 —— 那样会让 verify-config-docs 红。
const VIEWER_USER = process.env.PROBE_VIEWER_USER || "viewcheck";
const VIEWER_PASS = process.env.PROBE_VIEWER_PASS || "View#2026";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true });
  console.log(`SKIP  ${name}  → ${why}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
const call = async (method, path, body, headers = {}) => {
  const response = await fetch(BASE + path, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text };
};

const STAMP = Date.now().toString(36).slice(-5);
const MARK = `文件恢复探针-${STAMP}`;

// ---------- 1 先造一件标记物品,让今天那份自动备份里带上它 ----------
const created = await call("POST", "/api/items", { name: MARK, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 1, minQuantity: 0, remainingPercent: 100 });
const itemId = created.json?.id ?? null;
check("造出一件标记物品", Boolean(itemId), JSON.stringify(created.json).slice(0, 120));

const auto = await call("POST", "/api/backup/auto", {});
// 「今天已经备过」时接口会 skipped:true,那份**旧**文件里没有刚造的标记物品。
// 为了让这条检查真的能证明「恢复把删掉的东西带回来」,先把「今天已备份」的标记清掉,强制写一份新的。
if (auto.json?.skipped) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: null } }).catch(() => undefined);
  } finally {
    await prisma.$disconnect();
  }
}
const forced = auto.json?.skipped ? await call("POST", "/api/backup/auto", {}) : auto;
const status = await call("GET", "/api/backup/auto");
const fileNames = status.json?.fileNames ?? [];
check("自动备份接口把服务器上的备份清单给出来了(界面才能列出来选)", Array.isArray(fileNames) && fileNames.length > 0, JSON.stringify({ files: status.json?.files, latestFile: status.json?.latestFile, fileNames: fileNames.slice(-2) }));
const latest = forced.json?.file ?? status.json?.latestFile ?? fileNames.at(-1) ?? null;
check("拿到了一份包含标记物品的备份文件", Boolean(forced.json?.saved === true && forced.json?.file), JSON.stringify({ auto: auto.json, forced: forced.json, latest }));

// ---------- 2 把标记物品删掉,再从服务器上的备份把它恢复回来 ----------
if (itemId) await call("DELETE", `/api/items/${itemId}`, { permanent: true });
const gone = ((await call("GET", "/api/items?includeDeleted=1")).json ?? []).some((row) => row.name === MARK);
check("标记物品已删除(接下来才验证「恢复真的把它带回来」)", gone === false, `还在=${gone}`);

const restore = await call("POST", "/api/backup/restore", { fromFile: latest });
check("从服务器上的备份恢复成功", restore.status === 200, `status=${restore.status} ${JSON.stringify(restore.json?.error ?? "").slice(0, 100)}`);
check("响应里说明了来源文件名", restore.json?.sourceFile === latest, JSON.stringify(restore.json?.sourceFile ?? null));
const back = ((await call("GET", "/api/items?includeDeleted=1")).json ?? []).filter((row) => row.name === MARK);
check("标记物品确实被恢复了", back.length >= 1, `恢复后找到 ${back.length} 件`);

// ---------- 3 路径穿越与不存在的文件 ----------
const traversal = await call("POST", "/api/backup/restore", { fromFile: "../home-inventory.db" });
check("路径穿越被拒(只接受 home-inventory-年-月-日.json)", traversal.status === 400, `status=${traversal.status} ${JSON.stringify(traversal.json?.error ?? "").slice(0, 80)}`);
const missing = await call("POST", "/api/backup/restore", { fromFile: "home-inventory-1999-01-01.json" });
check("不存在的备份给出 404 与明确说明", missing.status === 404 && /找不到/.test(String(missing.json?.error ?? "")), `status=${missing.status} ${JSON.stringify(missing.json?.error ?? "").slice(0, 80)}`);

// ---------- 4 超过请求上限时要说「太大了」,不许说「不是合法的 JSON」 ----------
{
  const pad = "x".repeat(65 * 1024 * 1024);
  const oversized = `{"items":[],"locations":[],"shopping":[],"pad":"${pad}"}`;
  const tooBig = await call("POST", "/api/backup/restore", oversized);
  const message = String(tooBig.json?.error ?? "");
  check("超限请求体给出 413", tooBig.status === 413, `status=${tooBig.status} ${message.slice(0, 80)}`);
  check("文案说的是「太大了」并给出上限,而不是谎报 JSON 不合法", /超过/.test(message) && /上限/.test(message) && !/JSON/.test(message), message.slice(0, 120));
}

// ---------- 5 非管理员不能从服务器文件恢复 ----------
{
  let viewerCookie = null;
  try {
    viewerCookie = await loginCookie(BASE, VIEWER_USER, VIEWER_PASS);
  } catch {
    viewerCookie = null;
  }
  if (!viewerCookie) {
    skip("只读账号被拒(403)", "没有可用的只读账号(需要 viewcheck/View#2026,CI 里由 make-probe-accounts 创建)");
  } else {
    const res = await fetch(BASE + "/api/backup/restore", { method: "POST", headers: { cookie: viewerCookie, "content-type": "application/json" }, body: JSON.stringify({ fromFile: latest }) });
    check("只读账号不能从服务器文件恢复(403)", res.status === 403, `status=${res.status}`);
  }
}

// ---------- 收尾 ----------
for (const row of ((await call("GET", "/api/items?includeDeleted=1")).json ?? []).filter((entry) => String(entry.name) === MARK)) {
  await call("DELETE", `/api/items/${row.id}`, { permanent: true });
}
const leftover = ((await call("GET", "/api/items?includeDeleted=1")).json ?? []).filter((entry) => String(entry.name) === MARK);
check("探针物品已清理", leftover.length === 0, `还剩 ${leftover.length} 件`);

const failed = results.filter((entry) => !entry.ok);
const skipped = results.filter((entry) => entry.skipped);
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} 通过${skipped.length ? `(${skipped.length} 项跳过)` : ""}`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);