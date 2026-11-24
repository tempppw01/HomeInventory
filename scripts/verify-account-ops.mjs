// 账号管理写操作核对:改角色、停用、重置密码、删除 —— 重点看「是否即时生效」。
//
// 为什么专门测这一块:这类操作最怕「改了但没生效」。
//   · 把某人从管理员降为成员,若其已登录的会话仍保留管理员权限,等于降权失败
//   · 停用账号后旧会话还能继续用,等于停用失败
// 当前实现每次请求都从库里读用户(所以是即时生效的),这里把它守成不变量。
//
// 另外守住一条接口约定:新建账号只允许「成员/只读」,直接传 ADMIN 必须被**明确拒绝**
// (以前会被静默降级成 MEMBER,调用方还以为创建成功的是管理员)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-account-ops.mjs

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const ADMIN_USER = process.env.PROBE_USER || "bgs";
const ADMIN_PASS = process.env.PROBE_PASS;
if (!ADMIN_PASS) throw new Error("set PROBE_PASS");

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const loginRaw = async (username, password) => {
  // 这个套件本身要反复登录(建号 → 登录 → 停用后再试……),最容易撞上 12 次/分钟的限速;
  // 遇到 429 按 Retry-After 等待重试,把「被限速」与「登录失败」区分开。
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? 10);
      console.log(`      登录限速,等待 ${wait} 秒后重试(${attempt + 1}/8)`);
      await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
      continue;
    }
    const cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    return { status: response.status, cookie };
  }
  return { status: 429, cookie: "" };
};

const admin = await loginRaw(ADMIN_USER, ADMIN_PASS);
if (admin.status !== 200) throw new Error(`admin login failed: ${admin.status}`);

const call = async (cookie, method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed };
};

const NAME = `audit${Date.now().toString().slice(-6)}`;
const PASS_A = "Audit#2026a";
const PASS_B = "Audit#2026b";

// 1) 建一个管理员账号
// 新建账号只允许「成员/只读」;管理员必须创建后再授予(接口现在会明确拒绝 role=ADMIN)
const rejectedAdmin = await call(admin.cookie, "POST", "/api/auth/users", { username: NAME + "x", password: PASS_A, role: "ADMIN", displayName: "核对" });
check("创建时直接给管理员应被明确拒绝", rejectedAdmin.status === 400 && String(rejectedAdmin.body?.error ?? "").includes("管理员"), `status=${rejectedAdmin.status} error=${rejectedAdmin.body?.error}`);

const created = await call(admin.cookie, "POST", "/api/auth/users", { username: NAME, password: PASS_A, displayName: "权限核对" });
const userId = created.body?.id ?? created.body?.user?.id;
check("创建成员账号", created.status === 201 || created.status === 200, `status=${created.status} ${JSON.stringify(created.body).slice(0, 100)}`);

if (userId) {
  const promote = await call(admin.cookie, "PATCH", `/api/auth/users/${userId}`, { role: "ADMIN" });
  check("创建后可授予管理员", promote.status === 200, `status=${promote.status}`);

  // 2) 用该账号登录
  const sessionA = await loginRaw(NAME, PASS_A);
  check("新账号可以登录", sessionA.status === 200, `status=${sessionA.status}`);

  // 3) 该账号此时应能访问管理员接口
  const beforeDemote = await call(sessionA.cookie, "GET", "/api/auth/users");
  check("管理员账号可以列出用户", beforeDemote.status === 200, `status=${beforeDemote.status}`);

  // 4) 把它降为普通成员 —— 同一个会话应当立刻失去管理员权限
  const demote = await call(admin.cookie, "PATCH", `/api/auth/users/${userId}`, { role: "MEMBER" });
  check("降为普通成员请求成功", demote.status === 200, `status=${demote.status}`);

  const afterDemote = await call(sessionA.cookie, "GET", "/api/auth/users");
  check(
    "降权后旧会话立刻失去管理员权限(无需重新登录)",
    afterDemote.status === 403,
    `status=${afterDemote.status}(期望 403)`,
  );

  // 5) 停用 —— 旧会话应立刻失效
  const disable = await call(admin.cookie, "PATCH", `/api/auth/users/${userId}`, { active: false });
  check("停用请求成功", disable.status === 200, `status=${disable.status}`);

  const afterDisable = await call(sessionA.cookie, "GET", "/api/dashboard");
  check("停用后旧会话立刻失效", afterDisable.status === 401, `status=${afterDisable.status}(期望 401)`);

  const reloginWhileDisabled = await loginRaw(NAME, PASS_A);
  check("停用后无法重新登录", reloginWhileDisabled.status >= 400, `status=${reloginWhileDisabled.status}`);

  // 6) 恢复启用 + 重置密码
  await call(admin.cookie, "PATCH", `/api/auth/users/${userId}`, { active: true, role: "MEMBER" });
  const reset = await call(admin.cookie, "PATCH", `/api/auth/users/${userId}`, { password: PASS_B });
  check("重置密码请求成功", reset.status === 200, `status=${reset.status}`);

  const oldPass = await loginRaw(NAME, PASS_A);
  check("旧密码已失效", oldPass.status >= 400, `status=${oldPass.status}`);
  const newPass = await loginRaw(NAME, PASS_B);
  check("新密码可以登录", newPass.status === 200, `status=${newPass.status}`);

  // 7) 删除账号
  const removed = await call(admin.cookie, "DELETE", `/api/auth/users/${userId}`);
  check("删除账号请求成功", removed.status === 200 || removed.status === 204, `status=${removed.status}`);

  const afterDelete = await loginRaw(NAME, PASS_B);
  check("删除后无法登录", afterDelete.status >= 400, `status=${afterDelete.status}`);

  const stillLive = await call(newPass.cookie, "GET", "/api/dashboard");
  check("删除后旧会话失效", stillLive.status === 401, `status=${stillLive.status}(期望 401)`);
}

// ---------- 删号之后:历史里的操作人不能被说成「公开扫码」 ----------
{
  // 自带账号:建 → 登录 → 消耗 → 删号。(不能借用套件自己那个账号:跑到这里时它已经被停用/删除了)
  const actorName = `${NAME}actor`.slice(0, 30);
  const actorPass = "Actor#2026x";
  const actor = await call(admin.cookie, "POST", "/api/auth/users", { username: actorName, password: actorPass, displayName: `${NAME} 审计`, role: "MEMBER" });
  const actorId = actor.body?.id ?? actor.body?.user?.id ?? null;
  check("为这条检查建出一个临时账号", (actor.status === 200 || actor.status === 201) && Boolean(actorId), `status=${actor.status}`);

  const dash = await call(admin.cookie, "GET", "/api/dashboard");
  const items = Array.isArray(dash.body?.items) ? dash.body.items : [];
  const target = items.find((entry) => entry.quantity > 0 && entry.type === "CONSUMABLE") ?? items.find((entry) => entry.quantity > 0);
  check("有可用物品来做这条检查(防止空跑)", Boolean(target), `物品数=${items.length}`);

  if (actorId && target) {
    const actorSession = await loginRaw(actorName, actorPass);
    const consumedAt = Date.now();
    const consumed = await call(actorSession.cookie, "POST", `/api/items/${target.id}/consume`, { amount: 1 });
    check("临时账号能消耗一件", consumed.status === 200, `status=${consumed.status}`);

    const removed = await call(admin.cookie, "DELETE", `/api/auth/users/${actorId}`);
    check("删掉这个临时账号", removed.status === 200, `status=${removed.status}`);

    const activity = await call(admin.cookie, "GET", `/api/activity?itemId=${target.id}`);
    const rows = Array.isArray(activity.body) ? activity.body : [];
    // 只认「刚刚那次」:否则可能匹配到别人的历史记录,检查就变成空跑通过
    const record = rows.find((row) => row.action === "CONSUME" && new Date(row.createdAt).getTime() >= consumedAt - 5000);
    check("那次消耗的记录还在(审计不跟着账号一起消失)", Boolean(record), `记录数=${rows.length}`);
    check("它不是公开扫码(没有 scanRequestId)", Boolean(record) && !record.scanRequestId, JSON.stringify({ scanRequestId: record?.scanRequestId ?? null }));
    const label = record ? (record.user?.displayName || (record.scanRequestId ? "公开扫码" : "账号已删除")) : "";
    check("历史里显示成「账号已删除」而不是「公开扫码」", label === "账号已删除", `实际=${label}`);

    if (record?.id) await call(admin.cookie, "POST", `/api/activity/${record.id}/undo`);
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);