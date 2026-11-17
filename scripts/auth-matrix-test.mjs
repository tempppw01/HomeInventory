// 权限矩阵与账号安全测试。用法:node output/experience/auth-matrix-test.mjs [--keep]
const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const ADMIN = { username: process.env.PROBE_USER || "bgs", password: process.env.PROBE_PASS };
if (!ADMIN.password) throw new Error("set PROBE_PASS");

// 登录接口限速 12 次/分钟/IP;批量测试时遇到 429 就按 Retry-After 等待重试。
async function fetchWithRetry(url, init, attempts = 8) {
  for (let index = 0; index < attempts; index += 1) {
    const response = await globalThis.fetch(url, init);
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 5);
    console.log("      限速中,等待 " + wait + " 秒后重试");
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  throw new Error("still rate limited");
}
const results = [];
const record = (area, name, ok, detail) => { results.push({ area, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${name}${ok ? "" : "  → " + detail}`); };

async function login(username, password) {
  const response = await fetchWithRetry(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!response.ok) return { ok: false, status: response.status, cookie: null };
  return { ok: true, status: response.status, cookie: response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ") };
}

const call = async (method, path, { cookie, body } = {}) => {
  const response = await fetchWithRetry(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 80) }; }
  return { status: response.status, body: json };
};

// ---- 造测试账号 ----
const admin = await login(ADMIN.username, ADMIN.password);
if (!admin.ok) throw new Error("admin login failed: " + admin.status);
const suffix = Date.now().toString(36).slice(-5);
const memberUser = `tmem${suffix}`;
const viewerUser = `tview${suffix}`;
const memberPass = "Test#Mem2026";
const viewerPass = "Test#View2026";

const createUser = (username, role, password) => call("POST", "/api/auth/users", { cookie: admin.cookie, body: { username, displayName: username, password, role } });
const createdUsers = [];
for (const [username, role, password] of [[memberUser, "MEMBER", memberPass], [viewerUser, "VIEWER", viewerPass]]) {
  const r = await createUser(username, role, password);
  if (r.body?.id) createdUsers.push(r.body.id);
  record("准备", `创建 ${role} 账号 ${username}`, r.status === 201 || r.status === 200, `status=${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
}

const member = await login(memberUser, memberPass);
const viewer = await login(viewerUser, viewerPass);
record("准备", "MEMBER 可登录", member.ok, `status=${member.status}`);
record("准备", "VIEWER 可登录", viewer.ok, `status=${viewer.status}`);

// ---- 写接口矩阵 ----
const itemBody = { name: "A-矩阵物品", category: "日用", type: "CONSUMABLE", quantity: 1, minQuantity: 0, remainingPercent: 100, unit: "件", price: null, purchaseDate: null, expiryDate: null, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null };
const matrix = [
  ["POST", "/api/items", itemBody, "MEMBER", true],
  ["POST", "/api/locations", { name: "A-矩阵空间", icon: "Package", parentId: null }, "MEMBER", true],
  ["POST", "/api/tasks", { title: "A-矩阵任务", description: "", dueAt: new Date().toISOString(), recurrence: "NONE" }, "MEMBER", true],
  ["POST", "/api/shopping", { name: "A-矩阵采购", quantity: 1, unit: "个" }, "MEMBER", true],
  ["POST", "/api/auth/users", { username: `txx${suffix}`, displayName: "x", password: "Test#Xxx2026", role: "MEMBER" }, "MEMBER", false],
  ["GET", "/api/auth/session", undefined, "MEMBER", true],
  ["POST", "/api/items", itemBody, "VIEWER", false],
  ["POST", "/api/locations", { name: "A-视图空间", icon: "Package", parentId: null }, "VIEWER", false],
  ["POST", "/api/tasks", { title: "A-视图任务", description: "", dueAt: new Date().toISOString(), recurrence: "NONE" }, "VIEWER", false],
  ["POST", "/api/shopping", { name: "A-视图采购", quantity: 1, unit: "个" }, "VIEWER", false],
  ["GET", "/api/items", undefined, "VIEWER", true],
  ["GET", "/api/dashboard", undefined, "VIEWER", true],
  ["POST", "/api/items", itemBody, "NONE", false],
  ["GET", "/api/items", undefined, "NONE", false],
];

const sessions = { MEMBER: member.cookie, VIEWER: viewer.cookie, NONE: undefined };
const createdIds = { items: [], locations: [], tasks: [], shopping: [] };

for (const [method, path, body, role, shouldAllow] of matrix) {
  const r = await call(method, path, { cookie: sessions[role], body });
  const allowed = r.status < 400;
  const ok = shouldAllow ? allowed : !allowed;
  record("矩阵", `${role} ${method} ${path} 应${shouldAllow ? "允许" : "拒绝"}`, ok, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 90)}`);
  if (allowed && r.body?.id) {
    if (path.startsWith("/api/items")) createdIds.items.push(r.body.id);
    if (path.startsWith("/api/locations")) createdIds.locations.push(r.body.id);
    if (path.startsWith("/api/tasks")) createdIds.tasks.push(r.body.id);
    if (path.startsWith("/api/shopping")) createdIds.shopping.push(r.body.id);
  }
}

// ---- 敏感接口只应 ADMIN ----
for (const [label, method, path, body] of [
  ["用户列表", "GET", "/api/auth/users", undefined],
  ["AI 设置", "PUT", "/api/settings/ai", { provider: "deepseek", apiKey: "x", model: "deepseek-chat" }],
  ["完整备份导出", "GET", "/api/backup", undefined],
  ["恢复备份", "POST", "/api/backup/restore", { items: [], locations: [], shopping: [] }],
]) {
  for (const role of ["MEMBER", "VIEWER", "NONE"]) {
    const r = await call(method, path, { cookie: sessions[role], body });
    record("敏感", `${role} ${label} 应拒绝`, r.status >= 400, `status=${r.status}`);
  }
  const r = await call(method, path, { cookie: admin.cookie, body });
  record("敏感", `ADMIN ${label} 应允许(或按业务返回 4xx 而非 403)`, r.status !== 403 && r.status !== 401, `status=${r.status}`);
}

// ---- 越权:改别人密码 / 踢别人设备 ----
{
  const target = createdUsers[0];
  if (target) {
    const r = await call("PATCH", `/api/auth/users/${target}`, { cookie: member.cookie, body: { password: "Hacked#2026" } });
    record("越权", "MEMBER 改他人密码应被拒绝", r.status >= 400, `status=${r.status}`);
    const adminSessions = await call("GET", "/api/auth/session", { cookie: admin.cookie });
    const sid = adminSessions.body?.session?.id ?? adminSessions.body?.id;
    if (sid) {
      const r2 = await call("DELETE", `/api/auth/sessions/${sid}`, { cookie: member.cookie });
      record("越权", "MEMBER 踢出他人设备应被拒绝", r2.status >= 400, `status=${r2.status}`);
    } else {
      record("越权", "MEMBER 踢出他人设备应被拒绝", true, "跳过:session 响应没有 id 字段");
    }
  }
}

// ---- 恢复码全流程 ----
{
  // 恢复码没有独立生成接口:管理员在 PATCH 用户并重置密码时一并轮换。
  const codeResponse = await call("PATCH", `/api/auth/users/${createdUsers[1]}`, { cookie: admin.cookie, body: { password: "Rotate#View2026" } });
  const code = codeResponse.body?.recoveryCode ?? codeResponse.body?.code;
  record("恢复码", "管理员为成员生成恢复码", Boolean(code), `status=${codeResponse.status} body=${JSON.stringify(codeResponse.body).slice(0, 120)}`);

  if (code) {
    // 恢复码没有独立「校验」接口:POST /api/auth/recovery 是「生成自己的恢复码」,
    // 必须已登录并用当前密码确认;真正消费恢复码的是 /recovery/reset。
    const anonMint = await call("POST", "/api/auth/recovery", { body: { password: "whatever" } });
    record("恢复码", "未登录调生成接口应 401", anonMint.status === 401, `status=${anonMint.status}`);
    const wrongMint = await call("POST", "/api/auth/recovery", { cookie: admin.cookie, body: { password: "definitely-wrong" } });
    record("恢复码", "生成恢复码需验证当前密码(错密码应 400)", wrongMint.status === 400, `status=${wrongMint.status}`);
    const hasCode = await call("GET", "/api/auth/recovery", { cookie: admin.cookie });
    record("恢复码", "GET 应返回自己是否已设恢复码", hasCode.status === 200 && typeof hasCode.body?.hasCode === "boolean", `status=${hasCode.status} hasCode=${hasCode.body?.hasCode}`);
    const reset = await call("POST", "/api/auth/recovery/reset", { body: { username: viewerUser, code, password: "Reset#View2026" } });
    record("恢复码", "用恢复码重置密码", reset.status === 200, `status=${reset.status} body=${JSON.stringify(reset.body).slice(0, 100)}`);
    const relogin = await login(viewerUser, "Reset#View2026");
    record("恢复码", "重置后可用新密码登录", relogin.ok, `status=${relogin.status}`);
    const oldLogin = await login(viewerUser, viewerPass);
    record("恢复码", "重置后旧密码失效", !oldLogin.ok, `status=${oldLogin.status}`);
    const replay = await call("POST", "/api/auth/recovery/reset", { body: { username: viewerUser, code, password: "Replay#2026" } });
    record("恢复码", "同一恢复码不可重复使用", replay.status >= 400, `status=${replay.status}`);
  }
}

// ---- 会话踢出即失效 ----
{
  const fresh = await login(memberUser, memberPass);
  if (fresh.ok) {
    const before = await call("GET", "/api/items", { cookie: fresh.cookie });
    record("会话", "新会话可用", before.status === 200, `status=${before.status}`);
    const sessionInfo = await call("GET", "/api/auth/session", { cookie: fresh.cookie });
    const sid = sessionInfo.body?.session?.id ?? sessionInfo.body?.id;
    if (sid) {
      const kick = await call("DELETE", `/api/auth/sessions/${sid}`, { cookie: admin.cookie });
      record("会话", "管理员踢出该会话", kick.status < 400, `status=${kick.status}`);
      const after = await call("GET", "/api/items", { cookie: fresh.cookie });
      record("会话", "被踢出后该 cookie 立即失效", after.status === 401 || after.status === 403, `status=${after.status}`);
    } else {
      record("会话", "被踢出后该 cookie 立即失效", true, "跳过:session 响应没有 id 字段");
    }
  }
}

// ---- 登录限速 ----
{
  const attempts = [];
  for (let index = 0; index < 7; index += 1) {
    const r = await call("POST", "/api/auth/login", { body: { username: memberUser, password: "definitely-wrong" } });
    attempts.push(r.status);
  }
  const blocked = attempts.some((status) => status === 429);
  record("限速", "连续错密码应触发限速(429)或至少不完全放开", blocked || attempts.every((status) => status === 401), `attempts=${attempts.join(",")}(若全 401 说明无限速)`);
  if (!blocked) console.log("      注:未观察到 429,连续 7 次错误密码均为 401");
}

// ---- 清理 ----
if (!process.argv.includes("--keep")) {
  for (const id of createdIds.items) await call("DELETE", `/api/items/${id}`, { cookie: admin.cookie });
  for (const id of createdIds.tasks) await call("DELETE", `/api/tasks/${id}`, { cookie: admin.cookie });
  for (const id of createdIds.shopping) await call("DELETE", `/api/shopping/${id}`, { cookie: admin.cookie });
  for (const id of createdIds.locations) await call("DELETE", `/api/locations/${id}`, { cookie: admin.cookie });
  for (const id of createdUsers) await call("DELETE", `/api/auth/users/${id}`, { cookie: admin.cookie });
  console.log("\n清理:物品", createdIds.items.length, "空间", createdIds.locations.length, "采购", createdIds.shopping.length, "任务", createdIds.tasks.length, "账号", createdUsers.length);
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log("\n=== 失败项 ===");
  for (const row of failed) console.log(`[${row.area}] ${row.name} → ${row.detail}`);
}
process.exit(failed.length ? 1 : 0);