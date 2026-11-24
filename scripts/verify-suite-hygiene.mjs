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
//      想换一组套件:node scripts/verify-suite-hygiene.mjs --suites=verify-payload-budget,verify-import
//      (刻意不做成环境变量:每多一个环境变量都要进文档与配置检查,而这个开关只有测试用。)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

/** 默认这一组:都是**在空库上也能自己跑通**的套件(CI 里是空库)。
 * 注意 verify-import 与 verify-task-recurrence 也在其中 —— 上一版我把它们当成「依赖前面套件
 * 留下的数据」写进了说明,那是测量错误:真正的原因是当时 BASE_URL 指向空库、DATABASE_URL 还指向
 * 主库(见上面那条「必须同一个库」的断言)。它们本身是自足的。 */
const DEFAULT_SUITES = "verify-payload-budget,api-contract-test,verify-members-and-sysinfo,verify-user-isolation,verify-image-upload,verify-restock-pause,verify-shopping-purchase,auth-matrix-test,backup-roundtrip-test,verify-import,verify-task-recurrence,verify-restore-from-file";
const suitesArg = process.argv.find((arg) => arg.startsWith("--suites="));
const SUITES = (suitesArg ? suitesArg.slice("--suites=".length) : DEFAULT_SUITES)
  .split(",").map((name) => name.trim()).filter(Boolean);

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

/** 活动记录的**真实总数**:/api/activity 一次只回 100 行,用 rows.length 会在超过 100 条时
 *  永远显示"没有增长"(我自己先写成那样了)。真实总数在响应头 X-Total-Count 里。 */
const activityTotal = async () => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(BASE + "/api/activity", { headers: { cookie } });
      const header = res.headers.get("x-total-count");
      return header && /^\d+$/.test(header) ? Number(header) : NaN;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  return NaN;
};

const snapshot = async () => {
  const dash = (await get("/api/dashboard")) ?? {};
  return {
    "空间": list(dash.locations, "locations").map((row) => row.name),
    "物品": list(await get("/api/items?includeDeleted=1"), "items").map((row) => row.name),
    "采购": list(dash.shopping, "shopping").map((row) => row.name),
    "任务": list(await get("/api/tasks"), "tasks").map((row) => row.title),
    "成员": list(await get("/api/members"), "members").map((row) => row.name),
    "搜索历史": list(await get("/api/search-history"), "history").map((row) => row.query),
    "活动记录": await activityTotal(),
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
// 「防止空跑」不能要求库里已经有数据 —— CI 是**空库**,那样这条检查自己就会红
// (实测就是这么把 api 作业弄红的)。这里要确认的是「快照真的读到了状态」:
// 六个类别都拿到了数组、健康检查通,而不是「里面有几行」。
const health = await fetch(BASE + "/api/health").then((res) => res.status).catch(() => 0);
const arrayCategories = Object.entries(baseline).filter(([key]) => key !== "活动记录");
const arraysOk = arrayCategories.every(([, rows]) => Array.isArray(rows));
const activityOk = Number.isFinite(Number(baseline["活动记录"]));
check(
  "快照读得到(六类清单都是数组、活动记录是数字、服务健康)",
  health === 200 && arraysOk && activityOk,
  `health=${health} ${JSON.stringify(Object.fromEntries(Object.entries(baseline).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : rows])))}`,
);

// ---------- BASE_URL 与 DATABASE_URL 必须是同一个库 ----------
// 由来:我拿一个空库实例(3002)验「套件在空库上能不能自己跑」时,BASE_URL 指向空库,
// 而 DATABASE_URL 还是主库 —— 于是 verify-import 里「直接读库核对」的那条检查读到 0 行,
// 报出来像是「套件依赖前面套件留下的数据」。我照着这个结论把它从默认列表里移了出去,
// 后来才发现套件本身没问题,是我的环境没对齐。
// 这里就把「两边是不是同一个库」变成守卫的第一条断言:不一致时明确说出来,别让后面的失败被误读。
{
  const probeName = `卫生自检-${Date.now().toString(36).slice(-5)}`;
  const created = await fetch(BASE + "/api/items", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: probeName, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 1, minQuantity: 0, remainingPercent: 100 }),
  }).then((res) => res.json()).catch(() => null);
  const createdId = created?.id ?? created?.item?.id ?? null;
  let dbSees = null;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    dbSees = await prisma.item.findFirst({ where: { name: probeName }, select: { id: true } });
    if (createdId) await prisma.item.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  } catch (error) {
    dbSees = { error: String(error.message).slice(0, 120) };
  }
  if (createdId) await fetch(`${BASE}/api/items/${createdId}`, { method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) }).catch(() => undefined);
  const sameDatabase = Boolean(dbSees && !dbSees.error && dbSees.id === createdId);
  check(
    "BASE_URL 与 DATABASE_URL 指向同一个库(否则套件里「直接读库核对」的检查会误导)",
    sameDatabase,
    `接口建的 id=${createdId ?? "(建失败)"},按 DATABASE_URL 读库看到 ${dbSees?.error ?? dbSees?.id ?? "null"} —— 两边不是同一个库时请对齐后再跑`,
  );
  if (!sameDatabase) {
    // 立刻停:继续跑下去只会产出「缺数据」「逻辑不对」这类误导性的失败。
    console.log("\n库没对齐,后面的套件不跑了。请让 DATABASE_URL 指向 BASE_URL 那台服务用的库。");
    const early = results.filter((entry) => !entry.ok);
    console.log(`\n${results.length - early.length}/${results.length} 通过`);
    process.exit(1);
  }
}

const env = { ...process.env, BASE_URL: BASE, PROBE_USER: USER, PROBE_PASS: PASS };
// 本次运行被套件写进库里的活动记录条数(只是告知,不算失败)
let activityAdded = 0;
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
    // 活动记录**不算失败**:任何套件只要走真实接口就一定会写流水(实测每类操作恰好写 1 条),
    // 那是被测量系统本身的代价,不是"没清干净"。但必须**说出来** ——
    // 我自己就在这条上栽过:连续几轮把套件跑在真实库上,攒了 7.3 万条流水(约 29 MB)。
    if (category === "活动记录") {
      const added = Number(rows) - Number(before[category] ?? 0);
      if (added > 0) {
        activityAdded += added;
        console.log(`INFO  ${suite}:新增活动记录 ${added} 条(套件走真实接口的必然代价;要跑套件请用临时库)`);
      }
      continue;
    }
    const extra = grew(before[category] ?? [], rows);
    check(`${suite}:没有留下${category}`, extra.length === 0, `多了 ${extra.length} 个:${extra.slice(0, 6).join(" / ")}`);
  }
}

if (activityAdded > 0) console.log(`
本次运行新增活动记录 ${activityAdded} 条 —— 套件走真实接口必然写流水;要跑套件请用临时库(见 docs/verification.md)`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);