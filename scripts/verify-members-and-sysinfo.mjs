// 家庭成员(增/删)与系统信息的验收。
//
// 这两条接口此前**没有任何套件覆盖**。其中家庭成员更值得说:
// 它原来**只能加不能删** —— 界面里写错一个名字(比如「爸吧」),那条 chip 就会永远留在
// 设置页与家庭成员列表里。现在补了 DELETE 与 chip 上的移除按钮,这里把行为钉住。
//
// 系统信息则要确认:需要登录,且**不泄露任何连接串/密钥**(它读了 DATABASE_URL,但只推导出
// 「SQLite / MySQL」这种结论)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-members-and-sysinfo.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const NAME = `成员验收-${Date.now().toString(36)}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
const call = async (method, path, body, withCookie = cookie) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(withCookie ? { cookie: withCookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed, text };
};

const memberNames = async () => {
  const response = await call("GET", "/api/members");
  return Array.isArray(response.body) ? response.body.map((row) => String(row.name)) : [];
};

// 先清掉历史残留
for (const row of (await call("GET", "/api/members")).body ?? []) {
  if (String(row.name || "").startsWith("成员验收")) await call("DELETE", `/api/members/${row.id}`);
}

// ---------- ① 增删成员 ----------
{
  const created = await call("POST", "/api/members", { name: NAME });
  check("能添加家庭成员", created.status === 201 || created.status === 200, `status=${created.status}`);
  check("添加后出现在列表里", (await memberNames()).includes(NAME), JSON.stringify(await memberNames()).slice(0, 120));

  const id = created.body?.id;
  check("返回了成员 id", Boolean(id), JSON.stringify(created.body).slice(0, 120));

  if (id) {
    const removed = await call("DELETE", `/api/members/${id}`);
    check("能删除家庭成员", removed.status === 200, `status=${removed.status}`);
    check("删除后从列表消失", !(await memberNames()).includes(NAME), JSON.stringify(await memberNames()).slice(0, 120));

    const again = await call("DELETE", `/api/members/${id}`);
    check("重复删除给 404(不是 500)", again.status === 404, `status=${again.status}`);

    const missing = await call("DELETE", "/api/members/not-a-real-id");
    check("删除不存在的成员给 404", missing.status === 404, `status=${missing.status}`);
  }
}

// ---------- ② 空名字要被挡住 ----------
{
  const blank = await call("POST", "/api/members", { name: "   " });
  check("空名字被拒", blank.status >= 400 && blank.status < 500, `status=${blank.status}`);
}

// ---------- ③ 只读账号不能加也不能删 ----------
{
  const viewerPass = process.env.PROBE_VIEWER_PASS || "View#2026";
  let viewerCookie = null;
  try {
    viewerCookie = await loginCookie(BASE, process.env.PROBE_VIEWER_USER || "viewcheck", viewerPass);
  } catch {
    viewerCookie = null;
  }

  if (!viewerCookie) {
    console.log("      跳过「只读不能改成员」:拿不到只读账号");
  } else {
    const addAsViewer = await call("POST", "/api/members", { name: `${NAME}-viewer` }, viewerCookie);
    check("只读账号不能添加成员(403)", addAsViewer.status === 403, `status=${addAsViewer.status}`);

    // 用一个真实成员 id 试删除
    const created = await call("POST", "/api/members", { name: NAME });
    const delAsViewer = created.body?.id ? await call("DELETE", `/api/members/${created.body.id}`, undefined, viewerCookie) : { status: 0 };
    check("只读账号不能删除成员(403)", delAsViewer.status === 403, `status=${delAsViewer.status}`);
    if (created.body?.id) await call("DELETE", `/api/members/${created.body.id}`);
  }
}

// ---------- ③b 删账号时,它的家庭成员记录也要一起清掉 ----------
//
// 建号会顺带建一条家庭成员(带 userId);关系是 onDelete: SetNull,
// 所以只删 user 的话,那条成员会留下,已删账号的显示名就一直挂在「家庭成员」列表里。
{
  const username = `memberclean-${Date.now().toString(36)}`;
  const created = await call("POST", "/api/auth/users", { username, displayName: `成员清理检查-${username}`, password: "Member#2026x", role: "MEMBER" });
  const userId = created.body?.id ?? created.body?.user?.id ?? null;
  check("能给临时账号建号(顺带建家庭成员)", (created.status === 200 || created.status === 201) && Boolean(userId), `status=${created.status}`);

  if (userId) {
    const displayName = `成员清理检查-${username}`;
    const before = await memberNames();
    check("建号后家庭成员里出现了它的显示名", before.includes(displayName), JSON.stringify(before).slice(0, 120));

    const removed = await call("DELETE", `/api/auth/users/${userId}`, {});
    check("能删除该账号", removed.status === 200, `status=${removed.status}`);

    const after = await memberNames();
    check("删号后它的家庭成员记录也消失了", !after.includes(displayName), JSON.stringify(after).slice(0, 120));
  }
}

// ---------- ④ 系统信息:要登录,且不泄露敏感内容 ----------
{
  const anonymous = await call("GET", "/api/system/info", undefined, null);
  check("未登录访问系统信息被拒(401)", anonymous.status === 401, `status=${anonymous.status}`);

  const authed = await call("GET", "/api/system/info");
  check("登录后能读到系统信息", authed.status === 200 && Boolean(authed.body?.databaseLabel), JSON.stringify(authed.body).slice(0, 120));
  check("系统信息能说明用的是哪种数据库", ["SQLite", "MySQL"].includes(authed.body?.databaseLabel ?? ""), `databaseLabel=${authed.body?.databaseLabel}`);

  // 关键:不能把连接串 / 密钥带出来
  const raw = authed.text || "";
  const leaksDatabasePath = /\.db\b|file:|mysql:\/\//.test(raw) || raw.includes("DATABASE_URL");
  const leaksSecrets = /(accessKey|secret|password|token)/i.test(raw);
  check("系统信息不包含数据库连接串或路径", !leaksDatabasePath, raw.slice(0, 160));
  check("系统信息不包含任何密钥字段", !leaksSecrets, raw.slice(0, 160));
}

// 收尾
for (const row of (await call("GET", "/api/members")).body ?? []) {
  if (String(row.name || "").startsWith("成员验收")) await call("DELETE", `/api/members/${row.id}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);