// 角色界面验收:成员不该看到管理员专属的设置(它们只会 403)。
//
// 起因:MEMBER 的界面此前**原样展示**了「账号与家庭成员 / 新增成员账号 / 登录记录 /
// 图片存储 / AI 配置 / 完整备份」—— 而接口对成员一律返回 403。
// 于是用户填完「创建账号」表单点提交,只拿到一个看不懂的失败;
// 账号列表还会永远停在「正在读取账号... / 读取中」。
//
// 现在这些分区对成员/只读不渲染,并给出一句说明。这条检查守住两件事:
//   · 成员看不到管理员专属控件,也不再卡在读取中
//   · 管理员**照旧**能看到全部(避免「一刀切藏掉」)
//
// 同时补两条接口侧抽查:成员调用管理员接口必须 403(界面藏了,接口也不能松)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... PROBE_MEMBER_PASS=... node scripts/verify-role-ui.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const ADMIN_USER = process.env.PROBE_MEMBER_USER ? process.env.PROBE_USER || "leadcheck" : process.env.PROBE_USER || "leadcheck";
const ADMIN_PASS = process.env.PROBE_PASS || "Lead#2026";
const MEMBER_USER = process.env.PROBE_MEMBER_USER || "rcvlead";
const MEMBER_PASS = process.env.PROBE_MEMBER_PASS || "Rcv#2026x";
const VIEWER_USER = process.env.PROBE_VIEWER_USER || "viewcheck";
const VIEWER_PASS = process.env.PROBE_VIEWER_PASS || "View#2026";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const finish = async (code) => {
  await context.close();
  await browser.close();
  process.exit(code);
};

/** 以指定账号登录,并打开设置页(展开折叠分组) */
const openSettingsAs = async (user, pass) => {
  // 先进入应用再登出:在 about:blank 上发 /api/... 会因没有 origin 而报 URL 解析失败
  await page.goto(BASE);
  await page.waitForTimeout(1600);
  await page.evaluate(async () => { await fetch("/api/auth/logout", { method: "POST" }); });
  await page.goto(BASE);
  await page.waitForTimeout(2200);
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", user);
    await page.fill("#auth-password", pass);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3200);
  } else {
    const state = await page.evaluate(() => ({ hasForm: Boolean(document.querySelector("#auth-username")) }));
    if (state.hasForm) return { ok: false, detail: "登录表单未消失" };
  }
  await dismissBlockingDialogs(page);
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);
  await page.evaluate(() => { document.querySelectorAll("details").forEach((node) => { node.open = true; }); });
  await page.waitForTimeout(600);
  return { ok: true };
};

/** 用结构性标记判断管理员专属內容在不在(别用词语匹配 —— 说明文案里也含这些词) */
const settingsState = () => page.evaluate(() => {
  const text = document.querySelector("main")?.innerText || "";
  return {
    createAccountButton: Array.from(document.querySelectorAll("main button")).some((button) => (button.textContent || "").trim() === "创建账号"),
    newRoleSelect: Boolean(document.querySelector('select[aria-label="新账号权限"]')),
    fullBackupLink: Boolean(document.querySelector('a[href="/api/backup"]')),
    restoreLabel: text.includes("合并恢复备份"),
    aiEndpointField: text.includes("接口地址"),
    adminNote: text.includes("只有管理员可以查看和修改"),
    stuck: /正在读取账号|读取中/.test(text),
  };
});

/** 只读账号的设置页:哪些控件可改、哪些被置灰/隐藏 */
/**
 * 「我的密码」这一块(所有角色都该有):
 * 展开它,看三个输入框在不在、能不能聚焦、有没有可访问名。
 */
const selfServiceState = async () => {
  const hasSection = await page.evaluate(() => (document.querySelector("main")?.innerText || "").includes("我的密码"));
  const button = page.locator('main button:has-text("修改我的密码")').first();
  const hasButton = (await button.count()) > 0;
  if (hasButton) await button.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const inputs = ["#self-current-password", "#self-new-password", "#self-confirm-password"]
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);
    let focusable = inputs.length === 3;
    for (const input of inputs) {
      input.focus();
      if (document.activeElement !== input) focusable = false;
    }
    const named = inputs.every((input) => Boolean(input.labels && input.labels.length && (input.labels[0].textContent || "").trim()));
    return { hasSection: (document.querySelector("main")?.innerText || "").includes("我的密码"), hasButton: inputs.length === 3, fields: inputs.length, focusable, named };
  });
};

const viewerSettingsState = () => page.evaluate(() => {
  const controlDisabled = (label) => {
    const node = Array.from(document.querySelectorAll('main select, main button[role="switch"]'))
      .find((element) => element.getAttribute("aria-label") === label);
    return node ? Boolean(node.disabled) : false;
  };
  const text = document.querySelector("main")?.innerText || "";
  return {
    themeEnabled: !controlDisabled("外观主题"),
    densityEnabled: !controlDisabled("界面密度"),
    expiryDisabled: controlDisabled("临期提前提醒"),
    lowStockDisabled: controlDisabled("低库存提醒"),
    weeklyDayDisabled: controlDisabled("每周盘点提醒日"),
    importInput: Boolean(document.querySelector('input[type="file"][accept*="json"]')),
    memberInput: Boolean(document.querySelector('input[aria-label="成员名称"]')),
    exportLink: Boolean(document.querySelector('a[href="/api/items?export=1"]')),
    readonlyBadge: text.includes("只读账号不可修改"),
  };
});
// ---------- ① 成员视角:看不到管理员专属控件,也不再卡住 ----------
{
  const login = await openSettingsAs(MEMBER_USER, MEMBER_PASS);
  check("成员账号能登录", login.ok, login.detail ?? "");
  if (login.ok) {
    const state = await settingsState();
    check("成员看不到「创建账号」表单", !state.createAccountButton && !state.newRoleSelect, JSON.stringify(state));
    check("成员看不到完整备份与恢复入口", !state.fullBackupLink && !state.restoreLabel, JSON.stringify(state));
    check("成员看不到 AI 配置字段", !state.aiEndpointField, JSON.stringify(state));
    check("成员看到一句说明(为什么没有这些设置)", state.adminNote, JSON.stringify(state));
    check("成员不再卡在「读取中」", !state.stuck, JSON.stringify(state));

    // 账号自助:改自己的密码对所有角色开放(账号管理才只给管理员)。
    // 此前设置页里写的是 {isAdmin && <AccountSettings/>},成员连改密码的入口都没有。
    const self = await selfServiceState();
    check("成员能看到「我的密码」并展开表单", self.hasSection && self.hasButton && self.fields === 3, JSON.stringify(self));
    check("成员的三项密码输入都键盘可达、有名字", self.focusable && self.named, JSON.stringify(self));
  }
}

// ---------- ①b 只读视角:该留的能改、服务端设置置灰、写动作隐藏 ----------
//
// 只读账号同样能看到设置页,但里面的「写」控件点下去只会 403:
//   · 纯前端的显示偏好(主题/密度/动效)该留 —— 它存在浏览器本地,任何人都有权改
//   · 服务端的提醒设置该置灰(PATCH /api/settings/preferences 对只读是 403)
//   · 导入物品 / 添加成员该隐藏(POST 一律 403)
//   · 导出与记录该留(GET 都是 200)
{
  const login = await openSettingsAs(VIEWER_USER, VIEWER_PASS);
  check("只读账号能登录", login.ok, login.detail ?? "");
  if (login.ok) {
    const state = await viewerSettingsState();
    check("只读仍能改纯前端的显示偏好(主题/密度)", state.themeEnabled && state.densityEnabled, JSON.stringify(state));
    check("只读不能改服务端提醒设置(已置灰)", state.expiryDisabled && state.lowStockDisabled && state.weeklyDayDisabled, JSON.stringify(state));
    check("只读看不到写动作(导入 / 添加成员)", !state.importInput && !state.memberInput, JSON.stringify(state));
    check("只读看到「只读账号不可修改」的说明", state.readonlyBadge, JSON.stringify(state));
    check("只读仍能导出(GET 是允许的)", state.exportLink, JSON.stringify(state));

    // 只读的底线限的是家庭数据:自己的密码属于自助操作,入口该在。
    const self = await selfServiceState();
    check("只读也能看到「我的密码」并展开表单", self.hasSection && self.hasButton && self.fields === 3, JSON.stringify(self));
    check("只读的三项密码输入都键盘可达、有名字", self.focusable && self.named, JSON.stringify(self));
    check("只读仍然看不到「创建账号」表单", !state.createAccountButton && !state.newRoleSelect, JSON.stringify(state));
  }
}

// ---------- ② 管理员视角:照旧能看到全部(避免一刀切藏掉) ----------
{
  const login = await openSettingsAs(ADMIN_USER, ADMIN_PASS);
  check("管理员账号能登录", login.ok, login.detail ?? "");
  if (login.ok) {
    const state = await settingsState();
    check("管理员仍能看到「创建账号」表单", state.createAccountButton && state.newRoleSelect, JSON.stringify(state));
    check("管理员仍能看到完整备份与恢复入口", state.fullBackupLink && state.restoreLabel, JSON.stringify(state));
    check("管理员仍能看到 AI 配置字段", state.aiEndpointField, JSON.stringify(state));
    check("管理员看不到那条「管理员专属」说明", !state.adminNote, JSON.stringify(state));
  }
}

// ---------- ③ 接口侧抽查:界面藏了,接口也不能松 ----------
{
  await openSettingsAs(MEMBER_USER, MEMBER_PASS);
  const codes = await page.evaluate(async () => {
    const probe = async (method, path, body) => {
      const response = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      return response.status;
    };
    return {
      listUsers: await probe("GET", "/api/auth/users"),
      createUser: await probe("POST", "/api/auth/users", { username: "roleprobe", displayName: "越权试探", password: "Probe#2026x", role: "MEMBER" }),
      loginRecords: await probe("GET", "/api/auth/login-records"),
      fullBackup: await probe("GET", "/api/backup"),
      ossSettings: await probe("GET", "/api/settings/oss"),
    };
  });

  const lax = Object.entries(codes).filter(([, status]) => status !== 403);
  check("成员调用管理员接口一律 403", lax.length === 0, lax.map(([name, status]) => `${name}=${status}`).join(","));
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);