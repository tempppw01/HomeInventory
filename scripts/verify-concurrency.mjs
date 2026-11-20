// 并发行为的验收。
//
// 起因:实测发现「先查后建」的补货建议在并发下会各建一条 ——
// 6 个并发 PATCH 生成了 **6 条重复的采购建议**,用户的采购清单里会堆出一串同样的东西。
// (家庭应用里这是真实场景:两个人在两台设备上同时改同一件东西。)
//
// 这里把三种并发行为钉住:
//   1. 并发写入不会产生重复的补货建议
//   2. 并发消耗是原子的:不丢次数、也不会把数量减成负数
//   3. 历史上已经产生的重复建议,会在下次触发写入时被顺手清掉(自愈)
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-concurrency.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const NAME = "并发验收物品";

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
  return { status: response.status, body: parsed };
};

const dashboard = async () => (await call("GET", "/api/dashboard")).body ?? {};
const suggestionsFor = async (name) => (await dashboard()).shopping?.filter((row) => row.name === name) ?? [];

const cleanup = async () => {
  for (const row of await suggestionsFor(NAME)) await call("DELETE", `/api/shopping/${row.id}`);
  const items = (await dashboard()).items ?? [];
  for (const row of items.filter((entry) => entry.name === NAME)) {
    await call("DELETE", `/api/items/${row.id}`, {});
    await call("DELETE", `/api/items/${row.id}`, { permanent: true });
  }
};

const createItem = async (body) => (await call("POST", "/api/items", { name: NAME, category: "日用", type: "CONSUMABLE", // 注意别用「瓶」:液体走余量刻度,消耗接口会按设计返回 409(我第一次就踩了这个)
    unit: "件", ...body })).body;

await cleanup();

// ---------- ① 并发写入不产生重复的补货建议 ----------
{
  const item = await createItem({ quantity: 5, minQuantity: 3 });
  check("创建探针物品", Boolean(item?.id), JSON.stringify(item).slice(0, 120));

  if (item?.id) {
    const statuses = await Promise.all(
      Array.from({ length: 6 }, () => call("PATCH", `/api/items/${item.id}`, { quantity: 1 }).then((r) => r.status)),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const suggestions = await suggestionsFor(NAME);

    check("6 个并发写入都成功", statuses.every((status) => status === 200), `statuses=${statuses.join(",")}`);
    check("只产生 1 条补货建议(修复前是 6 条)", suggestions.length === 1, `实际=${suggestions.length} 条`);
  }
}

// ---------- ② 自愈:已有的重复建议会在下次写入时被清掉 ----------
{
  const item = await createItem({ quantity: 5, minQuantity: 3 });
  if (item?.id) {
    // 直接写库造出重复项:接口本身会按名字去重,塞不出重复(我第一次试的就是接口)
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    for (let index = 0; index < 2; index += 1) {
      await prisma.shoppingItem.create({
        data: { name: NAME, quantity: 2, unit: "件", category: "日用", priority: 2, source: "low-stock", status: "PENDING" },
      });
    }
    await prisma.$disconnect();
    const before = await suggestionsFor(NAME);

    await call("PATCH", `/api/items/${item.id}`, { quantity: 1 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const after = await suggestionsFor(NAME);

    check("排查前确实存在重复建议", before.length >= 2, `before=${before.length}`);
    check("下次写入时重复建议被清掉(自愈)", after.length === 1, `after=${after.length}`);
  }
}

// ---------- ③ 并发消耗是原子的 ----------
{
  await cleanup();
  const item = await createItem({ quantity: 10, minQuantity: 0 });
  if (item?.id) {
    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => call("POST", `/api/items/${item.id}/consume`, { amount: 1 }).then((r) => r.status)),
    );
    const after = (await dashboard()).items?.find((row) => row.id === item.id);
    check("10 个并发消耗全部成功", statuses.every((status) => status === 200), `statuses=${statuses.join(",")}`);
    check("数量正好减到 0(没丢次数也没减成负数)", Number(after?.quantity) === 0, `实际=${after?.quantity}`);
  }
}

// ---------- ④ 超额并发消耗不会把数量减成负数 ----------
{
  await cleanup();
  const item = await createItem({ quantity: 3, minQuantity: 0 });
  if (item?.id) {
    const statuses = await Promise.all(
      Array.from({ length: 6 }, () => call("POST", `/api/items/${item.id}/consume`, { amount: 1 }).then((r) => r.status)),
    );
    const succeeded = statuses.filter((status) => status === 200).length;
    const after = (await dashboard()).items?.find((row) => row.id === item.id);
    check("成功次数不超过库存数量", succeeded <= 3, `成功=${succeeded}`);
    check("数量归零且不为负", Number(after?.quantity) === 0, `实际=${after?.quantity}`);
  }
}

await cleanup();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);