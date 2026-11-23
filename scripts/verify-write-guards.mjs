// 写接口的权限矩阵:每一条写路径,对每一种角色,到底放不放行。
//
// 起因(这一轮真正的问题):`middleware.ts` 放在**仓库根目录**,而项目用的是 src/app 布局 ——
// Next 会静默忽略它,构建产物 .next/server/middleware-manifest.json 里是 "middleware": {}。
// 于是「只读账号禁止一切非 GET」「只有管理员能改系统设置」这两条从写下那天起就没运行过,
// 实测只读账号能 POST /api/ai/chat、能 DELETE /api/search-history(把搜索历史删掉),
// 其余写接口靠各自路由里的 canWrite() 兜着 —— 全靠自觉,没有兜底。
//
// 这个套件分两部分:
//   1) 静态:proxy 文件在**正确的位置**(src/proxy.ts),且没有留下误导人的根目录副本
//   2) 动态:逐条打写路径,校验每个角色的结果
//
// 只读账号的放行清单是刻意的(见 src/proxy.ts 注释):自己的密码/恢复码、
// 自己的搜索历史与 AI 对话记录、只读的 AI 提问与分析。
//
// 用法:PROBE_VIEWER_PASS=... PROBE_MEMBER_PASS=... node scripts/verify-write-guards.mjs

import { existsSync } from "node:fs";
import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const VIEWER_USER = process.env.PROBE_VIEWER_USER || "viewcheck";
const VIEWER_PASS = process.env.PROBE_VIEWER_PASS || "View#2026";
const MEMBER_USER = process.env.PROBE_MEMBER_USER || "rcvlead";
const MEMBER_PASS = process.env.PROBE_MEMBER_PASS || "Rcv#2026x";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

/**
 * 家庭数据的写路径。只读账号一条都不许过。
 * body 一律用空对象:能被 403 挡住的请求不会有副作用,
 * 而万一闸门失效,空 body 也只会撞上参数校验(400),不会真的写坏数据。
 */
const HOUSEHOLD_WRITES = [
  ["POST", "/api/items"],
  ["PATCH", "/api/items/__guard__"],
  ["DELETE", "/api/items/__guard__"],
  ["POST", "/api/items/__guard__/consume"],
  ["POST", "/api/items/__guard__/restore"],
  ["PATCH", "/api/items/bulk"],
  ["DELETE", "/api/items/bulk"],
  ["POST", "/api/items/batch"],
  ["POST", "/api/items/import"],
  ["POST", "/api/items/merge"],
  ["POST", "/api/upload"],
  ["POST", "/api/locations"],
  ["PATCH", "/api/locations/__guard__"],
  ["DELETE", "/api/locations/__guard__"],
  ["POST", "/api/members"],
  ["DELETE", "/api/members/__guard__"],
  ["POST", "/api/tasks"],
  ["POST", "/api/audits"],
  ["POST", "/api/shopping"],
  ["PATCH", "/api/shopping/__guard__"],
  ["DELETE", "/api/shopping/__guard__"],
  ["POST", "/api/prices"],
  ["POST", "/api/activity/__guard__/undo"],
];

/** 只读账号也允许的写请求(自己那份 / 只读提问)—— 只要不是 403 就说明放行生效 */
const VIEWER_ALLOWED = [
  ["POST", "/api/auth/password"],
  ["POST", "/api/search-history"],
  ["DELETE", "/api/search-history"],
  ["POST", "/api/ai/chat"],
  ["PUT", "/api/ai/chat/history"],
  ["POST", "/api/ai/analyze-item"],
];

/** 只有管理员能改的东西 */
const ADMIN_ONLY_WRITES = [
  ["PATCH", "/api/settings/ai"],
  ["POST", "/api/settings/ai/models"],
  ["PATCH", "/api/settings/oss"],
  ["PATCH", "/api/settings/preferences"],
  ["POST", "/api/auth/users"],
  ["PATCH", "/api/auth/users/__guard__"],
  ["DELETE", "/api/auth/users/__guard__"],
];

/** 公开接口:未登录也该放行到路由(登录、健康检查、扫码消耗) */
const PUBLIC_WRITES = [
  ["POST", "/api/auth/login"],
  ["POST", "/api/auth/setup"],
  ["POST", "/api/auth/recovery/reset"],
  ["POST", "/api/public/consume"],
];

const status = async (method, path, cookie) => {
  try {
    const response = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
      cache: "no-store",
    });
    return response.status;
  } catch {
    return -1;
  }
};

/** 连响应体一起取:公开接口要靠「错误文案」区分是闸门挡的,还是路由自己校验的 */
const probe = async (method, path, cookie) => {
  try {
    const response = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: "{}",
      cache: "no-store",
    });
    const text = await response.text();
    let error = "";
    try { error = JSON.parse(text).error ?? ""; } catch { /* 不是 JSON 就算了 */ }
    return { status: response.status, error: String(error) };
  } catch (error) {
    return { status: -1, error: String(error) };
  }
};

// ---------- 1 静态:proxy 必须在 src/ 下,且没有留下会被静默忽略的副本 ----------
check("src/proxy.ts 存在(Next 16 只会编译这个位置)", existsSync("src/proxy.ts"), "缺少 src/proxy.ts");
check("仓库根目录没有 middleware.ts(那个位置会被静默忽略)", !existsSync("middleware.ts"), "根目录又出现了 middleware.ts");
check("src/ 下没有 middleware.ts(已改名为 proxy)", !existsSync("src/middleware.ts"), "src/middleware.ts 仍然存在");

// ---------- 2 未登录:写请求一律 401 ----------
{
  const reachable = [];
  for (const [method, path] of HOUSEHOLD_WRITES) {
    const code = await status(method, path, null);
    if (code !== 401) reachable.push(`${method} ${path}=${code}`);
  }
  check("未登录时写接口一律 401", reachable.length === 0, reachable.slice(0, 6).join(","));
}

// ---------- 3 只读账号:家庭数据一条都不许写 ----------
{
  const cookie = await loginCookie(BASE, VIEWER_USER, VIEWER_PASS);
  check("只读账号能登录", Boolean(cookie));

  const leaked = [];
  for (const [method, path] of [...HOUSEHOLD_WRITES, ...ADMIN_ONLY_WRITES]) {
    const code = await status(method, path, cookie);
    if (code !== 403) leaked.push(`${method} ${path}=${code}`);
  }
  check(`只读账号被挡在所有写接口之外(${HOUSEHOLD_WRITES.length + ADMIN_ONLY_WRITES.length} 条)`, leaked.length === 0, leaked.slice(0, 8).join(","));

  const blocked = [];
  for (const [method, path] of VIEWER_ALLOWED) {
    const code = await status(method, path, cookie);
    if (code === 403 || code === 401) blocked.push(`${method} ${path}=${code}`);
  }
  check("只读账号自己的那份仍然可用(密码 / 搜索历史 / AI 提问)", blocked.length === 0, blocked.join(","));

  // 放行清单必须有边界:设置类接口一个都不能放进去
  const settingsLeak = [];
  for (const [method, path] of ADMIN_ONLY_WRITES) {
    if (await status(method, path, cookie) !== 403) settingsLeak.push(path);
  }
  check("放行清单没有把管理员接口一起放开", settingsLeak.length === 0, settingsLeak.join(","));
}

// ---------- 4 成员:能写家庭数据,但碰不到管理员专属 ----------
{
  const cookie = await loginCookie(BASE, MEMBER_USER, MEMBER_PASS);
  check("成员账号能登录", Boolean(cookie));

  const blocked = [];
  for (const [method, path] of ADMIN_ONLY_WRITES) {
    const code = await status(method, path, cookie);
    if (code !== 403) blocked.push(`${method} ${path}=${code}`);
  }
  check("成员改不了系统设置与账号列表", blocked.length === 0, blocked.join(","));

  const wrongfullyBlocked = [];
  for (const [method, path] of [
    ["POST", "/api/tasks"],
    ["POST", "/api/shopping"],
    ["POST", "/api/locations"],
    ["POST", "/api/items"],
  ]) {
    const code = await status(method, path, cookie);
    // 成员本来就该能写:400/201 都算「进到路由了」,只有 403/401 才是被闸门误伤
    if (code === 403 || code === 401) wrongfullyBlocked.push(`${method} ${path}=${code}`);
  }
  check("成员照旧能写家庭数据(没被只读规则误伤)", wrongfullyBlocked.length === 0, wrongfullyBlocked.join(","));
}

// ---------- 5 公开接口不因为这道闸门而需要登录 ----------
// 注意:登录接口用空口令本来就该 401(路由自己的校验),所以这里判的是
// 「是不是被闸门拦下了」—— 闸门的文案是「请先登录」。
{
  const broken = [];
  for (const [method, path] of PUBLIC_WRITES) {
    const { status: code, error } = await probe(method, path, null);
    if (error === "请先登录") broken.push(`${method} ${path}=${code}(被闸门拦下)`);
  }
  check("登录 / 初始化 / 扫码消耗 这类公开接口没有被闸门拦下", broken.length === 0, broken.join(","));
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);