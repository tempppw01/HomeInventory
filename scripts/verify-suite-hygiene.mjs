// 套件自己的卫生:跑完一批套件之后,库里不该多出任何东西。
//
// 由来:这一轮清本地库时发现,多个套件只建不删 ——
//   · 空间:载荷探针空间(verify-payload-budget)
//   · 任务:T-任务 / T-非法重复(api-contract-test)、A-矩阵任务(auth-matrix-test)、B-换滤芯(verify-write-guards)
//   · 物品:实例里积过 403 条 T- 前缀的合成物品
// 在 CI 里这些是「一次性库」看不出代价,但两件事是真的:
//   1 套件之间会互相影响 —— 之前 api 作业就因为「前面的套件把物品吃光了」红过一次;
//   2 谁在本地跑一遍,自己的家庭数据里就多一堆垃圾。
//
// 这里把「跑完不长东西」变成可执行的断言:每个套件跑之前拍快照,跑完比对,
// 多出什么就点出名字。要加进 CI 的套件保持在「快且有代表性」的几个。
//
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-suite-hygiene.mjs
//      想换一组:SUITES=verify-payload-budget,verify-import node scripts/verify-suite-hygiene.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

/** 默认挑「快 + 历史上会留东西」的几个;完整清单可以在 CI 里逐步加。 */
const SUITES = (process.env.SUITES || "verify-payload-budget,api-contract-test,verify-import,verify-task-recurrence").split(",").map((name) => name.trim()).filter(Boolean);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
// 本地/CI 都出现过偶发的连接重置(ECONNRESET),快照读失败不该让守卫直接崩掉。
const get = async (path, attempt = 1) => {
  try {
    const res = await fetch(BASE + path, { headers: { cookie } });
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    return get(path, attempt + 1);
  }
};
const list = (value, key) => (Array.isArray(value) ? value : value?.[key] ?? []);

const snapshot = async () => {
  const dash = (await get("/api/dashboard")) ?? {};
  return {
    "空间": list(dash.locations, "locations").map((row) => row.name),
    "物品": list(await get("/api/items?includeDeleted=1"), "items").map((row) => row.name),
    "采购": list(dash.shopping, "shopping").map((row) => row.name),
    "任务": list(await get("/api/tasks"), "tasks").map((row) => row.title),
    "成员": list(await get("/api/members"), "members").map((row) => row.name),
    "搜索历史": list(await get("/api/search-history"), "history").map((row) => row.query),
  };
};

/** 多重集合比较:同名的两条也算多了一条 */
const grew = (before, after) => {
  const counts = new Map();
  for (const name of before) counts.set(name, (counts.get(name) ?? 0) + 1);
  const extra = [];
  for (const name of after) {
    const left = counts.get(name) ?? 0;
    if (left > 0) counts.set(name, left - 1);
    else extra.push(name);
  }
  return extra;
};

const baseline = await snapshot();
check("快照读到了(防止空跑)", Object.values(baseline).some((rows) => rows.length > 0), JSON.stringify(Object.fromEntries(Object.entries(baseline).map(([key, rows]) => [key, rows.length]))));

const env = { ...process.env, BASE_URL: BASE, PROBE_USER: USER, PROBE_PASS: PASS };
for (const suite of SUITES) {
  const file = `scripts/${suite}.mjs`;
  try {
    readFileSync(file);
  } catch {
    check(`${suite}:脚本存在`, false, file);
    continue;
  }
  const before = await snapshot();
  let ran = true;
  let tail = "";
  try {
    const output = execFileSync("node", [file], { encoding: "utf8", env, stdio: "pipe" });
    tail = output.trim().split("\n").slice(-1)[0] ?? "";
  } catch (error) {
    ran = false;
    tail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().split("\n").slice(-2).join(" ");
  }
  const after = await snapshot();
  // 先确认套件自己过了:套件挂了就不必再谈卫生
  check(`${suite}:自己跑过`, ran, tail.slice(0, 200));
  if (!ran) continue;
  for (const [category, rows] of Object.entries(after)) {
    const extra = grew(before[category] ?? [], rows);
    check(`${suite}:没有留下${category}`, extra.length === 0, `多了 ${extra.length} 个:${extra.slice(0, 6).join(" / ")}`);
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);