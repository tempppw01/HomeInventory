// 登录门禁验收:未登录时不该看到任何家庭数据。
//
// 这是一条**安全相关**的行为,而且很容易在改版里被悄悄破坏(比如某个页面改成客户端取数、
// 或者某个接口漏加鉴权)。此前没有专门的检查。
//
// 覆盖:
//   · 未登录访问各应用路由 → 一律显示登录表单,**页面上不出现任何物品名**
//   · 未登录调用各数据接口 → 401 且提示可读
//   · 登录后同样的路由能看到内容(证明门禁不是「永久拦住」)
//   · 退出登录后重新被拦住
//   · 唯一的例外:`/consume/[id]` 按设计无需登录(扫码消耗页)—— 一并钉住,免得被误当成漏洞修掉
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-auth-gate.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

// 演示数据里的物品名:未登录页面上一个都不该出现
const DATA_MARKERS = ["布洛芬", "云南白药", "医用外科口罩", "连花清瘟", "巴氏鲜奶", "可口可乐", "青岛啤酒", "农夫山泉", "简爱酸奶"];
const ROUTES = ["/", "/items", "/settings", "/audit", "/report"];
// 注意:别把 /api/shopping 放进来 —— 它不支持 GET(405),那是方法问题不是鉴权问题,
// 混在一起会让「必须 401」这条断言假失败(我第一次就这么写的)。
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

const pageState = () => page.evaluate((markers) => {
  // 注意:这里直接用模块级常量,别再让调用方传参 —— 第一次就是忘了传,拿到 undefined 才炸的
  const text = document.body.innerText || "";
  return {
    hasLoginForm: Boolean(document.querySelector("#auth-username")),
    leaked: markers.filter((marker) => text.includes(marker)),
    head: text.replace(/\n+/g, " | ").slice(0, 80),
  };
}, DATA_MARKERS);

// ---------- ① 未登录:各路由都显示登录表单,且不泄露数据 ----------
{
  let allGated = true;
  const leaks = [];
  for (const route of ROUTES) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2200);
    const state = await pageState();
    if (!state.hasLoginForm) {
      allGated = false;
      console.log(`      ${route} 没有显示登录表单:${state.head}`);
    }
    if (state.leaked.length) leaks.push(`${route}:${state.leaked.join(",")}`);
  }
  check("未登录访问 5 个应用路由都显示登录表单", allGated, "有路由未显示登录表单(见上)");
  check("未登录页面上不出现任何物品名", leaks.length === 0, leaks.join(" | "));
}

// ---------- ② 未登录:数据接口一律 401 ----------
{
  const results401 = await page.evaluate(async (paths) => {
    const out = {};
    for (const path of paths) {
      const response = await fetch(path, { cache: "no-store" });
      const text = await response.text();
      out[path] = { status: response.status, body: text.slice(0, 80) };
    }
    return out;
  }, APIS);

  const bad = Object.entries(results401).filter(([, value]) => value.status !== 401);
  check("未登录调用数据接口一律 401", bad.length === 0, bad.map(([path, value]) => `${path}=${value.status}`).join(","));
  check("401 的提示是可读中文", Object.values(results401).every((value) => /登录/.test(value.body)), JSON.stringify(results401).slice(0, 160));
}

// ---------- ③ 登录后:同样的路由能看到内容 ----------
{
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2600);
  const state = await pageState();
  check("登录后能看到物品列表(门禁不是永久拦住)", !state.hasLoginForm && state.leaked.length > 0, `head=${state.head}`);
}

// ---------- ④ 退出登录后重新被拦住 ----------
{
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(2600);
  // 登录后可能弹出欢迎引导,它会挡住点击
  await dismissBlockingDialogs(page);
  // 设置项是折叠分组,先全部展开,否则按钮在 DOM 里但不可见
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((node) => { node.open = true; });
  });
  await page.waitForTimeout(600);
  // 文案是「退出当前账号」——不是「退出登录」(我照直觉写错过一次)
  const logout = page.locator('button:has-text("退出当前账号")').first();
  const hasLogout = (await logout.count()) > 0;
  check("设置页有退出入口(退出当前账号)", hasLogout, "没找到退出按钮");

  if (hasLogout) {
    await logout.click();
    await page.waitForTimeout(3200);
    await page.goto(`${BASE}/items`);
    await page.waitForTimeout(2200);
    const state = await pageState();
    check("退出后再次访问被拦住", state.hasLoginForm && state.leaked.length === 0, `head=${state.head} leaked=${state.leaked.join(",")}`);
  }
}

// ---------- ⑤ 唯一的例外:扫码消耗页按设计无需登录 ----------
//
// 用**专用探针物品**:页面打开即会消耗 1 件,不能拿演示数据做这事。
{
  await page.goto(BASE);
  await page.waitForTimeout(1800);
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", USER);
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }

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
    // 换一个干净上下文(没有任何 cookie),模拟「别人扫到标签上的二维码」
    const anonContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`${BASE}/consume/${probe.code}`);
    await anonPage.waitForTimeout(2600);
    const anonText = await anonPage.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "));
    const anonHasItem = anonText.includes("门禁验收探针");
    await anonContext.close();

    check("扫码消耗页无需登录即可访问(设计如此)", anonHasItem && /扫码消耗/.test(anonText), anonText.slice(0, 120));

    // 顺便确认它确实消耗了一次(说明这条公开路径是「可用」而不是「看得见但没用」)
    const after = await page.evaluate(async (id) => {
      const response = await fetch(`/api/items/${id}`, { cache: "no-store" });
      return response.ok ? await response.json() : null;
    }, probe.id);
    check("公开扫码路径真的完成了消耗", Number(after?.quantity) === 1, `数量=${after?.quantity}`);

    // 清掉探针
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
