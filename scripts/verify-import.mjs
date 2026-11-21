// 导入接口验收(/api/items/import)。
//
// 这条接口此前**没有被任何套件覆盖过**,而它承担着「从 CSV / 旧备份搬数据进来」这件事:
//   · 逐行校验,并把错误按行号报回来(用户要能知道第几行错了)
//   · 最多 1000 行,超出要明确标记 truncated
//   · locationName 里出现不存在的空间时自动建出来,并回报建了哪些
//   · 只读账号必须 403
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-import.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const STAMP = Date.now().toString(36);
const NEW_LOCATION = `导入验收空间-${STAMP}`;
const ITEM_PREFIX = `导入验收-${STAMP}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
const call = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed, text };
};

const itemsNow = async () => {
  const response = await call("GET", "/api/items");
  const rows = Array.isArray(response.body) ? response.body : (response.body?.items ?? []);
  return rows;
};

// 清理直接用 Prisma:批量导入会造 1000 条,逐个调删除接口太慢、列表接口还可能分页漏项。
// (其它套件里也有直接用 Prisma 造/清数据的先例。)
const withDb = async (run) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
};

const cleanup = async () => {
  const removed = await withDb(async (prisma) => {
    const rows = await prisma.item.findMany({ where: { name: { startsWith: ITEM_PREFIX } }, select: { id: true } });
    if (rows.length) await prisma.item.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    return rows.length;
  });
  if (removed) console.log(`      清理:删掉 ${removed} 条导入探针物品`);
};
await cleanup();

// ---------- ① 正常导入:进库、自动建空间、并回报建了哪些 ----------
{
  const imported = await call("POST", "/api/items/import", {
    items: [
      { name: `${ITEM_PREFIX}-A`, category: "日用", type: "CONSUMABLE", unit: "包", quantity: 3, locationName: NEW_LOCATION },
      { name: `${ITEM_PREFIX}-B`, category: "食品", type: "CONSUMABLE", unit: "盒", quantity: 2, expiryDate: "2026-12-31T00:00:00.000Z" },
    ],
  });

  check("能导入合法数据", (imported.status === 200 || imported.status === 201) && imported.body?.count === 2, `status=${imported.status} count=${imported.body?.count}`);
  check("回报了自动新建的空间", Array.isArray(imported.body?.createdLocations) && imported.body.createdLocations.some((path) => String(path).includes(NEW_LOCATION)), JSON.stringify(imported.body?.createdLocations));

  const rows = await itemsNow();
  const a = rows.find((item) => item.name === `${ITEM_PREFIX}-A`);
  const b = rows.find((item) => item.name === `${ITEM_PREFIX}-B`);
  check("导入的物品真的进库了", Boolean(a && b), `找到 A=${Boolean(a)} B=${Boolean(b)}`);
  check("物品落到了自动创建的空间里", Boolean(a?.location?.name === NEW_LOCATION || a?.locationName === NEW_LOCATION), `location=${a?.location?.name ?? a?.locationName ?? "?"}`);
  check("带时区的时间戳被截成日期(不因时区挪一天)", Boolean(b?.expiryDate) && new Date(b.expiryDate).getDate() === 31, `expiryDate=${b?.expiryDate}`);
}

// ---------- ② 格式不对:明确 400,而不是 500 ----------
{
  const notArray = await call("POST", "/api/items/import", { items: "这不是数组" });
  check("非数组给 400 且有可读提示", notArray.status === 400 && /格式/.test(notArray.body?.error ?? ""), `status=${notArray.status} error=${notArray.body?.error}`);

  const allBad = await call("POST", "/api/items/import", { items: [{ name: "" }, { name: "x", quantity: -5 }] });
  check("整批都不合法时返回 400 并逐行报错", allBad.status === 400 && Array.isArray(allBad.body?.errors) && allBad.body.errors.length >= 2, `status=${allBad.status} errors=${JSON.stringify(allBad.body?.errors)?.slice(0, 120)}`);
}

// ---------- ③ 部分合法:好的进库,坏的报行号 ----------
{
  const mixed = await call("POST", "/api/items/import", {
    items: [
      { name: `${ITEM_PREFIX}-C`, category: "日用", type: "CONSUMABLE", unit: "包", quantity: 1 },
      { name: "", category: "日用" },
    ],
  });

  check("部分合法时仍然导入好的那条", (mixed.status === 200 || mixed.status === 201) && mixed.body?.count === 1, `status=${mixed.status} count=${mixed.body?.count}`);
  check("坏行按行号报错", Array.isArray(mixed.body?.errors) && mixed.body.errors[0]?.row === 2, JSON.stringify(mixed.body?.errors)?.slice(0, 120));
}

// ---------- ④ 超过 1000 行:截断并明确标记 ----------
{
  const rows = Array.from({ length: 1005 }, (_, index) => ({ name: `${ITEM_PREFIX}-bulk-${index}`, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 1 }));
  const bulk = await call("POST", "/api/items/import", { items: rows });
  check("超过 1000 行时只导入 1000 条", (bulk.status === 200 || bulk.status === 201) && bulk.body?.count === 1000, `status=${bulk.status} count=${bulk.body?.count}`);
  check("并明确标记被截断", bulk.body?.truncated === true, `truncated=${bulk.body?.truncated}`);
}

// ---------- ⑤ 只读账号必须 403 ----------
{
  const viewerPass = process.env.PROBE_VIEWER_PASS || "View#2026";
  let viewerCookie = null;
  try {
    viewerCookie = await loginCookie(BASE, process.env.PROBE_VIEWER_USER || "viewcheck", viewerPass);
  } catch {
    viewerCookie = null;
  }

  if (!viewerCookie) {
    console.log("      跳过「只读账号导入被拒」:拿不到只读账号");
  } else {
    const response = await fetch(`${BASE}/api/items/import`, {
      method: "POST",
      headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ name: `${ITEM_PREFIX}-viewer`, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 1 }] }),
    });
    check("只读账号导入被拒(403)", response.status === 403, `status=${response.status}`);
  }
}

await cleanup();

// 空间也清掉(导入时自动建的那个)
{
  const locations = await call("GET", "/api/dashboard");
  const target = (locations.body?.locations ?? []).find((row) => String(row.name || "").includes(NEW_LOCATION));
  if (target) await call("DELETE", `/api/locations/${target.id}`, {});
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);