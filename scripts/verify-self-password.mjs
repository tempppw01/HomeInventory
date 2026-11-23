// 账号自助改密码验收(/api/auth/password)。
//
// 为什么要有这一条:此前设置页里写的是 `{isAdmin && <AccountSettings/>}`,于是**成员和只读账号
// 根本没有改自己密码的入口** —— 只能麻烦管理员替你重置,或者用恢复码走一次「忘记密码」
// (那会顺带轮换恢复码)。这个接口就是补上这条路。
//
// 一次跑完这几种情况:
//   1 未登录 → 401
//   2 当前密码不对 → 400,且提示是中文
//   3 新密码太短 / 与原密码相同 → 400
//   4 改成功后:旧密码登不进来,新密码可以登进来
//   5 改密码会吊销**其它设备**的会话,但当前这台继续有效
//   6 只读账号也能改自己的密码(middleware 对「家庭数据」的写保护不受影响)
//
// 全程用临时账号,不碰现有账号的密码。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-self-password.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const ADMIN_USER = process.env.PROBE_USER || "bgs";
const ADMIN_PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const stamp = Date.now().toString(36).slice(-6);
const memberUser = `selfpw${stamp}`;
const viewerUser = `selfvw${stamp}`;
const initialPassword = "Init#2026x";
const newPassword = "Changed#2026y";

const api = async (method, path, { cookie, body } = {}) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 120) }; }
  return { status: response.status, body: parsed };
};

const sessionOk = async (cookie) => {
  const result = await api("GET", "/api/auth/session", { cookie });
  return Boolean(result.body?.authenticated);
};

let adminCookie = null;
try {
  adminCookie = await loginCookie(BASE, ADMIN_USER, ADMIN_PASS);
} catch (error) {
  check("管理员能登录(否则后面的都测不了)", false, error instanceof Error ? error.message : String(error));
  process.exit(1);
}
check("管理员能登录(否则后面的都测不了)", Boolean(adminCookie));

const created = [];
const cleanup = async () => {
  for (const user of created) {
    await api("DELETE", `/api/auth/users/${user.id}`, { cookie: adminCookie });
  }
};

try {
  // ---------- 准备两个临时账号:普通成员 + 只读 ----------
  const member = await api("POST", "/api/auth/users", { cookie: adminCookie, body: { username: memberUser, displayName: "自助改密探针", password: initialPassword, role: "MEMBER" } });
  const viewer = await api("POST", "/api/auth/users", { cookie: adminCookie, body: { username: viewerUser, displayName: "只读改密探针", password: initialPassword, role: "VIEWER" } });
  if (member.status !== 201 || viewer.status !== 201) {
    check("创建临时账号(成员 + 只读)", false, `member=${member.status} viewer=${viewer.status}`);
    await cleanup();
    process.exit(1);
  }
  created.push({ id: member.body.id }, { id: viewer.body.id });
  check("创建临时账号(成员 + 只读)", true);

  // ---------- 1 未登录 ----------
  const anonymous = await api("POST", "/api/auth/password", { body: { currentPassword: initialPassword, newPassword } });
  check("未登录改密码 → 401", anonymous.status === 401, `status=${anonymous.status}`);

  // ---------- 2 当前密码不对 ----------
  let memberCookie = await loginCookie(BASE, memberUser, initialPassword);
  const wrong = await api("POST", "/api/auth/password", { cookie: memberCookie, body: { currentPassword: "不是这个密码", newPassword } });
  check("当前密码不对 → 400 且提示可读", wrong.status === 400 && /当前密码/.test(String(wrong.body?.error)), `status=${wrong.status} error=${wrong.body?.error}`);

  // ---------- 3 新密码太短 / 与原密码相同 ----------
  const tooShort = await api("POST", "/api/auth/password", { cookie: memberCookie, body: { currentPassword: initialPassword, newPassword: "short" } });
  check("新密码太短 → 400", tooShort.status === 400 && /至少/.test(String(tooShort.body?.error)), `status=${tooShort.status} error=${tooShort.body?.error}`);
  const same = await api("POST", "/api/auth/password", { cookie: memberCookie, body: { currentPassword: initialPassword, newPassword: initialPassword } });
  check("新密码与当前密码相同 → 400", same.status === 400, `status=${same.status} error=${same.body?.error}`);

  // ---------- 5(先准备第二个会话,再改密码,一起看吊销) ----------
  const otherCookie = await loginCookie(BASE, memberUser, initialPassword);
  check("改密前:两台设备都在线", (await sessionOk(memberCookie)) && (await sessionOk(otherCookie)));

  // ---------- 4 正确改密 ----------
  const changed = await api("POST", "/api/auth/password", { cookie: memberCookie, body: { currentPassword: initialPassword, newPassword } });
  check("当前密码正确 → 改密成功(200)", changed.status === 200 && changed.body?.ok === true, `status=${changed.status} body=${JSON.stringify(changed.body).slice(0, 80)}`);

  const oldLogin = await api("POST", "/api/auth/login", { body: { username: memberUser, password: initialPassword } });
  check("旧密码登不进来了", oldLogin.status === 401, `status=${oldLogin.status}`);
  let freshCookie = null;
  try { freshCookie = await loginCookie(BASE, memberUser, newPassword); } catch { freshCookie = null; }
  check("新密码可以登录", Boolean(freshCookie));

  // ---------- 5 其它设备的会话被吊销,当前这台还在 ----------
  check("当前这台设备的会话继续有效", await sessionOk(memberCookie));
  check("其它设备上的会话已被吊销", !(await sessionOk(otherCookie)));

  // ---------- 6 只读账号也能改自己的密码,但仍不能改家庭数据 ----------
  const viewerCookie = await loginCookie(BASE, viewerUser, initialPassword);
  const viewerChange = await api("POST", "/api/auth/password", { cookie: viewerCookie, body: { currentPassword: initialPassword, newPassword } });
  check("只读账号也能改自己的密码(自助操作,不是家庭数据)", viewerChange.status === 200, `status=${viewerChange.status} error=${viewerChange.body?.error}`);
  const viewerWrite = await api("PATCH", "/api/settings/preferences", { cookie: viewerCookie, body: { lowStockReminder: true } });
  check("只读账号改家庭设置仍然 403(只读的底线没被放宽)", viewerWrite.status === 403, `status=${viewerWrite.status}`);
  const viewerOld = await api("POST", "/api/auth/login", { body: { username: viewerUser, password: initialPassword } });
  check("只读账号的旧密码同样失效", viewerOld.status === 401, `status=${viewerOld.status}`);

  if (freshCookie) {
    const back = await api("POST", "/api/auth/password", { cookie: freshCookie, body: { currentPassword: newPassword, newPassword: initialPassword } });
    check("可以再改回去(不是一次性)", back.status === 200, `status=${back.status}`);
  }
} finally {
  await cleanup();
  const leftover = await api("GET", "/api/auth/users", { cookie: adminCookie });
  const rows = Array.isArray(leftover.body) ? leftover.body : [];
  check("临时账号已清理", rows.every((row) => row.username !== memberUser && row.username !== viewerUser), `剩余=${rows.map((row) => row.username).join(",")}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);