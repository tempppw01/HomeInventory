// 跨用户数据隔离验收。
//
// 这个应用是「一个家庭共用一份库存」,物品/空间/记录本来就共享 ——
// 但**聊天记录**与**搜索历史**是按用户存的(userId 过滤)。
// 「张三的搜索词/对话别出现在李四那里」这条此前没测过:
// 一起写错 WHERE 条件,数据就会串到别的家人眼前。
//
// 用两个真实账号交叉验证:
//   · A 存了聊天记录与搜索词 → B 看不到;B 存的也不影响 A 的
//   · 顺带确认「覆盖写入只影响自己」:PUT 会先删自己的再写入,B 的写入不能清掉 A 的
//
// 用法:PROBE_USER=leadcheck PROBE_PASS=... PROBE_MEMBER_USER/PASS=... node scripts/verify-user-isolation.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER_A = process.env.PROBE_USER || "leadcheck";
const PASS_A = process.env.PROBE_PASS || "Lead#2026";
const USER_B = process.env.PROBE_MEMBER_USER || "rcvlead";
const PASS_B = process.env.PROBE_MEMBER_PASS || "Rcv#2026x";

const MARK_A = `隔离检查A-${Date.now()}`;
const MARK_B = `隔离检查B-${Date.now()}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const makeClient = (cookie) => async (method, path, body) => {
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

const a = makeClient(await loginCookie(BASE, USER_A, PASS_A));
const b = makeClient(await loginCookie(BASE, USER_B, PASS_B));

const chatTexts = (response) => (response.body?.messages ?? []).map((message) => String(message.content ?? ""));
const searchQueries = (response) => (Array.isArray(response.body) ? response.body : []).map((row) => String(row.query ?? ""));

// 先清干净,避免历史数据干扰判断
await a("PUT", "/api/ai/chat/history", { messages: [] });
await b("PUT", "/api/ai/chat/history", { messages: [] });
await a("DELETE", "/api/search-history");
await b("DELETE", "/api/search-history");

// ---------- ① 聊天记录:A 写入后只有 A 能看到 ----------
{
  const savedByA = await a("PUT", "/api/ai/chat/history", {
    messages: [{ role: "user", content: MARK_A }, { role: "assistant", content: `${MARK_A}-回复` }],
  });
  check("A 能保存自己的聊天记录", savedByA.status === 200, `status=${savedByA.status}`);

  const readByA = await a("GET", "/api/ai/chat/history");
  check("A 能读回自己的聊天记录", chatTexts(readByA).some((text) => text.includes(MARK_A)), `messages=${chatTexts(readByA).length}`);

  const readByB = await b("GET", "/api/ai/chat/history");
  check("B 看不到 A 的聊天记录", !chatTexts(readByB).some((text) => text.includes(MARK_A)), `B 看到了:${chatTexts(readByB).join(" / ").slice(0, 80)}`);
}

// ---------- ② B 覆盖写入不能清掉 A 的记录 ----------
{
  const savedByB = await b("PUT", "/api/ai/chat/history", { messages: [{ role: "user", content: MARK_B }] });
  check("B 能保存自己的聊天记录", savedByB.status === 200, `status=${savedByB.status}`);

  const readByB = await b("GET", "/api/ai/chat/history");
  check("B 只看到自己的(看不到 A 的)", readByB.body?.messages?.length === 1 && chatTexts(readByB)[0].includes(MARK_B), JSON.stringify(chatTexts(readByB)).slice(0, 120));

  const readByA = await a("GET", "/api/ai/chat/history");
  check("B 的写入没有清掉 A 的记录", chatTexts(readByA).some((text) => text.includes(MARK_A)), JSON.stringify(chatTexts(readByA)).slice(0, 120));
}

// ---------- ③ 搜索历史同样按用户隔离 ----------
{
  await a("POST", "/api/search-history", { query: MARK_A });
  await b("POST", "/api/search-history", { query: MARK_B });

  const listA = await a("GET", "/api/search-history");
  const listB = await b("GET", "/api/search-history");

  check("A 的搜索历史里有自己的词", searchQueries(listA).includes(MARK_A), JSON.stringify(searchQueries(listA)).slice(0, 120));
  check("A 的搜索历史里没有 B 的词", !searchQueries(listA).includes(MARK_B), JSON.stringify(searchQueries(listA)).slice(0, 120));
  check("B 的搜索历史里有自己的词", searchQueries(listB).includes(MARK_B), JSON.stringify(searchQueries(listB)).slice(0, 120));
  check("B 的搜索历史里没有 A 的词", !searchQueries(listB).includes(MARK_A), JSON.stringify(searchQueries(listB)).slice(0, 120));
}

// 收尾:清掉两个账号的探针数据
await a("PUT", "/api/ai/chat/history", { messages: [] });
await b("PUT", "/api/ai/chat/history", { messages: [] });
await a("DELETE", "/api/search-history");
await b("DELETE", "/api/search-history");

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);