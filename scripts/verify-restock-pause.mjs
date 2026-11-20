// 「暂停补货提醒」的服务端行为验收。
//
// 背景:这个字段一直存在,客户端也尊重它(item-forecast 会跳过、角标不提示),
// 但**服务端生成采购建议时完全没判断** —— 用户暂停了提醒,后台仍在悄悄生成采购项。
// 而且界面上一直没有入口能设置它,所以此前几乎没人能发现这个问题。
//
// 这里验证的是服务端这一半:暂停期内不生成建议、过期后恢复生成。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-restock-pause.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

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

const NAME = "补货暂停验收品";

/**
 * 该物品当前有没有待处理的采购建议。
 * 注意:采购清单在 /api/dashboard 里 —— /api/shopping 不支持 GET(会拿到 405),
 * 这一点我先写错过,套件因此把「有建议」误判成「没建议」。
 */
const pendingSuggestion = async () => {
  const response = await call("GET", "/api/dashboard");
  const rows = response.body?.shopping ?? [];
  return rows.find((row) => row.name === NAME && row.status === "PENDING") ?? null;
};

/** 清掉该名字的所有采购项(含历史残留)与物品 */
const cleanup = async () => {
  const shopping = await call("GET", "/api/dashboard");
  const rows = shopping.body?.shopping ?? [];
  for (const row of rows.filter((entry) => entry.name === NAME)) {
    await call("DELETE", `/api/shopping/${row.id}`);
  }
  const items = await call("GET", "/api/items");
  const list = Array.isArray(items.body) ? items.body : (items.body?.items ?? []);
  for (const row of list.filter((entry) => entry.name === NAME)) {
    await call("DELETE", `/api/items/${row.id}`, {});
    await call("DELETE", `/api/items/${row.id}`, { permanent: true });
  }
};

await cleanup();

// ① 低于最小库存 → 服务端自动生成采购建议(基线行为)
const created = await call("POST", "/api/items", {
  name: NAME,
  category: "日用",
  type: "CONSUMABLE",
  unit: "瓶",
  quantity: 1,
  minQuantity: 5,
});
check("创建低库存物品", created.status === 201 || created.status === 200, `status=${created.status}`);
const itemId = created.body?.id;

const suggestionAfterCreate = await pendingSuggestion();
check("低库存时服务端生成了采购建议(基线)", Boolean(suggestionAfterCreate), "没有生成建议");
if (suggestionAfterCreate) await call("DELETE", `/api/shopping/${suggestionAfterCreate.id}`);

if (itemId) {
  // ② 暂停补货提醒后,再次触发评估也不该生成建议
  const paused = await call("PATCH", `/api/items/${itemId}`, {
    quantity: 1,
    minQuantity: 5,
    restockPausedUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  check("能设置「暂停补货提醒」", paused.status === 200, `status=${paused.status}`);

  await call("DELETE", `/api/shopping/${(await pendingSuggestion())?.id ?? "x"}`);
  // 再改一次数量,触发服务端重新评估
  await call("PATCH", `/api/items/${itemId}`, { quantity: 0 });
  const duringPause = await pendingSuggestion();
  check("暂停期内不再生成采购建议", duringPause === null, `仍然生成了:${duringPause?.name}`);

  // ③ 暂停期结束后恢复生成
  await call("PATCH", `/api/items/${itemId}`, {
    restockPausedUntil: new Date(Date.now() - 86400000).toISOString(),
  });
  await call("PATCH", `/api/items/${itemId}`, { quantity: 0 });
  const afterPause = await pendingSuggestion();
  check("暂停期过后恢复生成采购建议", Boolean(afterPause), "没有恢复生成");

  // ④ 消耗接口同样尊重暂停
  if (afterPause) await call("DELETE", `/api/shopping/${afterPause.id}`);
  await call("PATCH", `/api/items/${itemId}`, {
    quantity: 5,
    restockPausedUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  await call("POST", `/api/items/${itemId}/consume`, { amount: 1 });
  const afterConsume = await pendingSuggestion();
  check("消耗到低库存时,暂停期内也不生成建议", afterConsume === null, `生成了:${afterConsume?.name}`);
}

await cleanup();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);