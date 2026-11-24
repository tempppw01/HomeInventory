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

// ---------- 5 同一条消耗被并发撤销:只该生效一次 ----------
// 界面上「撤销」是个按钮,连点两下、两台设备同时点都会发生。
// 实测(SQLite):6 个并发 → 1 个 200 + 5 个 409,数量只 +1。
{
  const name = `${NAME}-撤销`;
  const item = (await call("POST", "/api/items", { name, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 10, minQuantity: 0, remainingPercent: 100 })).body;
  if (item?.id) {
    const consumed = await call("POST", `/api/items/${item.id}/consume`, {});
    const before = (await dashboard()).items?.find((row) => row.id === item.id)?.quantity;
    const undos = await Promise.all(Array.from({ length: 6 }, () => call("POST", `/api/activity/${consumed.body?.activityId}/undo`, {}).then((r) => r.status)));
    const after = (await dashboard()).items?.find((row) => row.id === item.id)?.quantity;
    check("并发撤销同一条消耗:只有 1 次成功", undos.filter((status) => status === 200).length === 1, `statuses=${undos.join(",")}`);
    check("其余的明确说「已经撤销」而不是 5xx", undos.filter((status) => status === 409).length === 5, `statuses=${undos.join(",")}`);
    check("数量只退 1 次", Number(after) === Number(before) + 1, `${before} → ${after}`);
    await call("DELETE", `/api/items/${item.id}`, { permanent: true });
  }
}

// ---------- 6 同一条采购项被并发标记「已购买 + 入库」:库存只该加一次 ----------
// 这条比数量更贵:多加一次就是库存虚高(v0.1.56 用 stockedAt 记账守的就是它)。
{
  const name = `${NAME}-入库`;
  const item = (await call("POST", "/api/items", { name, category: "食品", type: "CONSUMABLE", unit: "盒", quantity: 10, minQuantity: 0, remainingPercent: 100 })).body;
  const shopping = (await call("POST", "/api/shopping", { name, quantity: 3, unit: "盒", category: "食品", priority: 1, source: "manual" })).body;
  const shoppingId = shopping?.item?.id ?? shopping?.id;
  if (item?.id && shoppingId) {
    const burst = await Promise.all(Array.from({ length: 4 }, () => call("PATCH", `/api/shopping/${shoppingId}`, { status: "PURCHASED", replenishItemId: item.id })));
    const after = (await dashboard()).items?.find((row) => row.id === item.id)?.quantity;
    const claimed = burst.filter((row) => row.body?.stocked === true).length;
    check("4 次并发「已购买 + 入库」都成功", burst.every((row) => row.status === 200), `statuses=${burst.map((row) => row.status).join(",")}`);
    check("库存只加了一次(10 → 13)", Number(after) === 13, `实际=${after}`);
    check("只有一个响应声称这次入库了", claimed === 1, `声称=${claimed}`);
    await call("DELETE", `/api/shopping/${shoppingId}`);
  }
  if (item?.id) await call("DELETE", `/api/items/${item.id}`, { permanent: true });
}

// ---------- 7 扫码幂等:同一个 requestId 并发重复提交,只扣 1 件 ----------
// 手机网络差时重试、连点都会带着同一个 requestId 打进来。
{
  const name = `${NAME}-扫码幂等`;
  const item = (await call("POST", "/api/items", { name, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 5, minQuantity: 0, remainingPercent: 100 })).body;
  if (item?.id) {
    const requestId = crypto.randomUUID();
    const burst = await Promise.all(Array.from({ length: 4 }, () => call("POST", "/api/public/consume", { itemId: item.id, requestId })));
    const after = (await dashboard()).items?.find((row) => row.id === item.id)?.quantity;
    const consumed = burst.reduce((sum, row) => sum + Number(row.body?.consumed ?? 0), 0);
    const logs = (await call("GET", `/api/activity?itemId=${item.id}`)).body ?? [];
    const consumeRows = logs.filter((row) => row.action === "CONSUME").length;
    check("同一个 requestId 重复提交不报错(重试要能安全回来)", burst.every((row) => row.status === 200), `statuses=${burst.map((row) => row.status).join(",")}`);
    check("库存只扣 1 件", Number(after) === 4, `实际=${after}`);
    check("响应里 consumed 合计只有 1", consumed === 1, `实际=${consumed}`);
    check("流水里只有 1 条消耗", consumeRows === 1, `实际=${consumeRows}`);
    await call("DELETE", `/api/items/${item.id}`, { permanent: true });
  }
}

// ---------- 8 最后一件:并发扫不同的 requestId,只该有 1 个成功 ----------
{
  const name = `${NAME}-最后一件`;
  const item = (await call("POST", "/api/items", { name, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 1, minQuantity: 0, remainingPercent: 100 })).body;
  if (item?.id) {
    const race = await Promise.all(Array.from({ length: 4 }, () => call("POST", "/api/public/consume", { itemId: item.id, requestId: crypto.randomUUID() })));
    const after = (await dashboard()).items?.find((row) => row.id === item.id)?.quantity;
    check("只剩 1 件时并发扫码只有 1 个成功", race.filter((row) => row.status === 200).length === 1, `statuses=${race.map((row) => row.status).join(",")}`);
    check("其余明确说「库存不足」而不是 5xx", race.filter((row) => row.status === 409).length === 3, `statuses=${race.map((row) => row.status).join(",")}`);
    check("数量不会变成负数", Number(after ?? 0) === 0, `实际=${after}`);
    await call("DELETE", `/api/items/${item.id}`, { permanent: true });
  }
}

// ---------- 9 并发下调余量:流水首尾相接,且不会因此退错余量 ----------
// 余量是滑杆,连拖几下会并发提交。实测要先说清楚一件事:
//   并发写的是**绝对值**(直接把"余量=60%"落库),到达顺序乱了就会出现「40% → 60%」这种**上调**,
//   上调按设计不记消耗流水 —— 所以「3 次下调必定 3 条流水」是错的(我第一版就这么写了,红了)。
// 真正该守的是两件确定性的事:每条流水都带了前后余量;撤销只认最近一次,不会把余量退到错的地方。
{
  const name = `${NAME}-余量链`;
  const item = (await call("POST", "/api/items", { name, category: "日用", type: "CONSUMABLE", unit: "瓶", quantity: 2, minQuantity: 0, remainingPercent: 100 })).body;
  if (item?.id) {
    const patches = await Promise.all([60, 40, 20].map((percent) => call("PATCH", `/api/items/${item.id}`, { remainingPercent: percent })));
    const current = (await dashboard()).items?.find((row) => row.id === item.id);
    const logs = ((await call("GET", `/api/activity?itemId=${item.id}`)).body ?? []).filter((row) => row.action === "CONSUME").reverse();
    check("3 次并发下调余量都成功", patches.every((row) => row.status === 200), `statuses=${patches.map((row) => row.status).join(",")}`);
    check("最终余量是提交过的值之一(要么 20 要么 40 要么 60)", [20, 40, 60].includes(Number(current?.remainingPercent)), `实际=${current?.remainingPercent}`);
    check("每条消耗流水都记下了前后余量", logs.length >= 1 && logs.every((row) => typeof row.percentBefore === "number" && typeof row.percentAfter === "number"), JSON.stringify(logs.map((row) => `${row.percentBefore}%→${row.percentAfter}%`)));
    // 只断言「每一步都是下降」——**不断言链条首尾相接**:
    // 并发写的是绝对值,而流水的排序按 createdAt,写入顺序与记录顺序本来就可能不一致
    // (MySQL 上实测出现过 "20% → 60%" 这种断口,那是并发到达顺序的必然,不是缺陷)。
    // 串行场景下的「100→60→40」链条由 verify-consume-chain 守着。
    const notDecreasing = logs.filter((row) => !(row.percentAfter < row.percentBefore));
    check("每条「消耗」流水都是余量下降(上调不该记成消耗)", notDecreasing.length === 0, JSON.stringify(notDecreasing.map((row) => `${row.percentBefore}%→${row.percentAfter}%`)));

    // 撤销规则(v0.1.57):只允许撤销**当时最新的**那条余量消耗。
    // 所以顺序是:先撤更早的 → 必须 409;再撤最新的 → 200 且余量回到它的起点;
    // 这时更早那条成了"最新",再撤它就是合法操作(不是漏判)。
    if (logs.length >= 2) {
      const newer = logs[logs.length - 1];
      const older = logs[logs.length - 2];
      const tooEarly = await call("POST", `/api/activity/${older.id}/undo`, {});
      check("还有更新的消耗时,撤更早的那条会被拒绝", tooEarly.status === 409, `status=${tooEarly.status} ${JSON.stringify(tooEarly.body).slice(0, 60)}`);

      const newerUndo = await call("POST", `/api/activity/${newer.id}/undo`, {});
      const afterNewer = (await dashboard()).items?.find((row) => row.id === item.id);
      check("撤掉最新那次后,余量正好回到它的起点", newerUndo.status === 200 && Number(afterNewer?.remainingPercent) === newer.percentBefore, `期望 ${newer.percentBefore}%,实际 ${afterNewer?.remainingPercent}%`);

      const olderNow = await call("POST", `/api/activity/${older.id}/undo`, {});
      const afterOlder = (await dashboard()).items?.find((row) => row.id === item.id);
      check("它成为最近一次之后就允许撤销,余量继续回到更早的起点(不会跨步乱跳)", olderNow.status === 200 && Number(afterOlder?.remainingPercent) === older.percentBefore, `status=${olderNow.status} 期望 ${older.percentBefore}%,实际 ${afterOlder?.remainingPercent}%`);
    }
    await call("DELETE", `/api/items/${item.id}`, { permanent: true });
  }
}

// ---------- 10 余量消耗被并发撤销:余量只回一次 ----------
{
  const name = `${NAME}-余量撤销`;
  const item = (await call("POST", "/api/items", { name, category: "日用", type: "CONSUMABLE", unit: "瓶", quantity: 2, minQuantity: 0, remainingPercent: 100 })).body;
  if (item?.id) {
    await call("PATCH", `/api/items/${item.id}`, { remainingPercent: 60 });
    const logs = ((await call("GET", `/api/activity?itemId=${item.id}`)).body ?? []).filter((row) => row.action === "CONSUME" && !row.undoneAt);
    const undos = await Promise.all(Array.from({ length: 4 }, () => call("POST", `/api/activity/${logs[0]?.id}/undo`, {}).then((r) => r.status)));
    const after = (await dashboard()).items?.find((row) => row.id === item.id);
    check("余量消耗并发撤销:只有 1 次成功", undos.filter((status) => status === 200).length === 1, `statuses=${undos.join(",")}`);
    check("余量只回退一次(回到 100%)", Number(after?.remainingPercent) === 100, `实际=${after?.remainingPercent}`);
    check("瓶数没有被多退(仍是 2)", Number(after?.quantity) === 2, `实际=${after?.quantity}`);
    await call("DELETE", `/api/items/${item.id}`, { permanent: true });
  }
}

await cleanup();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);