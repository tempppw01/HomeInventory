// 登录门禁验收:未登录时不该看到任何家庭数据。
//
// 这是一条**安全相关**的行为,而且很容易在改版里被悄悄破坏(某个页面改成客户端取数、
// 某个接口漏加鉴权)。此前没有专门的检查。
//
// 做法上有一点要特别注意:用来判断「有没有泄露数据」的物品名**必须从当前环境动态取**,
// 不能写死。我第一次就是写死了本地演示数据里的 9 个物品名 —— CI 用的是另一批种子数据,
// 于是阳性对照(登录后应当能看到物品名)直接失败。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-auth-gate.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const ROUTES = ["/", "/items", "/settings", "/audit", "/report"];
// 注意:/api/shopping 不支持 GET(405,方法问题不是鉴权问题),别放进来
const APIS = ["/api/dashboard", "/api/items", "/api/activity", "/api/audits", "/api/tasks", "/api/settings/preferences"];

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

const login = async () => {
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", USER);
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  await dismissBlockingDialogs(page);
};

/** 页面状态:是否显示登录表单、是否出现给定的物品名 */
const pageState = (markers) => page.evaluate((list) => {
  const text = document.body.innerText || "";
  return {
    hasLoginForm: Boolean(document.querySelector("#auth-username")),
    leaked: list.filter((marker) => text.includes(marker)),
    head: text.replace(/\n+/g, " | ").slice(0, 90),
  };
}, markers);

// ---------- ① 先登录,取「当前环境真实存在的物品名」当标记,并做阳性对照 ----------
await login();

const markers = await page.evaluate(async () => {
  const response = await fetch("/api/items", { cache: "no-store" });
  const body = await response.json();
  const rows = Array.isArray(body) ? body : (body.items ?? []);
  return rows.map((row) => String(row.name || "")).filter(Boolean).slice(0, 4);
});
check("取到了用于判断泄露的物品名(动态取自当前环境)", markers.length > 0, `markers=${JSON.stringify(markers)}`);

const loggedIn = await pageState(markers);
const listRendered = await page.evaluate(() => document.querySelectorAll('main button[aria-label="更多操作"]').length);
check("阳性对照:登录后页面上确实能看到物品(检测本身有效)", !loggedIn.hasLoginForm && (loggedIn.leaked.length > 0 || listRendered > 0), `leaked=${loggedIn.leaked.length} cards=${listRendered}`);

// ---------- ② 退出后:各路由只给登录表单,且不出现任何物品名 ----------
await page.evaluate(async () => { await fetch("/api/auth/logout", { method: "POST" }); });
await page.waitForTimeout(600);

{
  let allGated = true;
  const leaks = [];
  for (const route of ROUTES) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2100);
    const state = await pageState(markers);
    if (!state.hasLoginForm) {
      allGated = false;
      console.log(`      ${route} 没有显示登录表单:${state.head}`);
    }
    if (state.leaked.length) leaks.push(`${route}:${state.leaked.join(",")}`);
  }
  check("未登录访问 5 个应用路由都显示登录表单", allGated, "有路由未显示登录表单(见上)");
  check("未登录页面上不出现任何物品名", leaks.length === 0, leaks.join(" | "));
}

// ---------- ③ 未登录:数据接口一律 401 ----------
{
  const responses = await page.evaluate(async (paths) => {
    const out = {};
    for (const path of paths) {
      const response = await fetch(path, { cache: "no-store" });
      out[path] = { status: response.status, body: (await response.text()).slice(0, 80) };
    }
    return out;
  }, APIS);

  const bad = Object.entries(responses).filter(([, value]) => value.status !== 401);
  check("未登录调用数据接口一律 401", bad.length === 0, bad.map(([path, value]) => `${path}=${value.status}`).join(","));
  check("401 的提示是可读中文", Object.values(responses).every((value) => /登录/.test(value.body)), JSON.stringify(responses).slice(0, 160));
}

// ---------- ④ 重新登录后:设置页能退出,退出后又被拦住 ----------
{
  await login();
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  // 设置项是折叠分组,先展开;文案是「退出当前账号」而不是「退出登录」
  await page.evaluate(() => { document.querySelectorAll("details").forEach((node) => { node.open = true; }); });
  await page.waitForTimeout(600);

  const logout = page.locator('button:has-text("退出当前账号")').first();
  const hasLogout = (await logout.count()) > 0;
  check("设置页有退出入口(退出当前账号)", hasLogout, "没找到退出按钮");

  if (hasLogout) {
    await logout.click();
    await page.waitForTimeout(3200);
    await page.goto(`${BASE}/items`);
    await page.waitForTimeout(2200);
    const state = await pageState(markers);
    check("退出后再次访问被拦住", state.hasLoginForm && state.leaked.length === 0, `head=${state.head} leaked=${state.leaked.join(",")}`);
  }
}

// ---------- ⑤ 唯一的例外:扫码消耗页按设计无需登录 ----------
//
// 用**专用探针物品**:页面打开即会消耗 1 件,不能拿演示数据做这事。
{
  await login();
  const probe = await page.evaluate(async () => {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "门禁验收探针", category: "日用", type: "CONSUMABLE", unit: "包", quantity: 2 }),
    });
    const item = await response.json();
    return { id: item?.id ?? null, code: item?.itemCode ?? null };
  });

  if (!probe.code) {
    console.log("      跳过「扫码页无需登录」:探针物品没建出来");
  } else {
    const anonContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`${BASE}/consume/${probe.code}`);
    await anonPage.waitForTimeout(2600);
    const anonText = await anonPage.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "));
    await anonContext.close();

    check("扫码消耗页无需登录即可访问(设计如此)", anonText.includes("门禁验收探针") && /扫码消耗/.test(anonText), anonText.slice(0, 120));

    const after = await page.evaluate(async (id) => {
      const response = await fetch(`/api/items/${id}`, { cache: "no-store" });
      return response.ok ? await response.json() : null;
    }, probe.id);
    check("公开扫码路径真的完成了消耗", Number(after?.quantity) === 1, `数量=${after?.quantity}`);

    await page.evaluate(async (id) => {
      await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
      await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) });
    }, probe.id);
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);