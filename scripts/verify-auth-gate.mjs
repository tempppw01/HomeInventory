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

import { PrismaClient } from "@prisma/client";
import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const ROUTES = ["/", "/items", "/settings", "/audit", "/report"];
// 注意:/api/shopping 不支持 GET(405,方法问题不是鉴权问题),别放进来
const APIS = ["/api/dashboard", "/api/items", "/api/activity", "/api/audits", "/api/tasks", "/api/settings/preferences"];

/** 应用外壳那一块 chunk(app/(app)/layout-*.js):掐掉它就等于 React 永远不会启动。 */
const isShellChunk = (url) => /\/_next\/static\/chunks\/app\/(?:\(app\)\/)?layout-[^/]*\.js$/.test(url);

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
    // 探针是「已登录状态下建一件消耗品」,建不出来意味着别的环节坏了 ——
    // 此前这里只打印一句「跳过」就继续,于是套件照样 18/18 全绿:一条没量到的检查
    // 不应该看起来像通过(2026-11-27 同一类问题的另一半)。
    check("扫码消耗页无需登录即可访问(设计如此)", false, "探针物品没建出来,这条没量到");
    check("公开扫码路径真的完成了消耗", false, "同上:探针物品没建出来");
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

// ---------- 6 脚本取不到时,不能永远停在「正在检查账号状态...」 ----------
// 这个场景是真实遇到的:端口上还挂着上一轮构建的服务,页面引用的 chunk 名对不上,
// 整个应用打不开 —— 却既不报错也不给提示,只有「正在检查账号状态...」永远转下去。
// 这里把应用外壳那块 chunk 请求掐掉来复现,断言 8 秒后出现一句可操作的话和一个能点的入口。
{
  const broken = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const brokenPage = await broken.newPage();
  await brokenPage.route("**/_next/static/chunks/**", (route) => {
    const url = route.request().url();
    // 只掐「应用外壳」那一块,其余资源照常放行。
    if (isShellChunk(url)) return route.abort();
    return route.continue();
  });

  await brokenPage.goto(BASE);
  await brokenPage.waitForTimeout(1500);
  const early = await brokenPage.evaluate(() => {
    const el = document.getElementById("boot-fallback");
    return { present: Boolean(el), visible: Boolean(el && !el.hidden) };
  });
  // 它不是「加载中」提示,而是「已经确定卡住了」的提示:头 1.5 秒里不该出现。
  check("脚本取不到时:一开始只显示加载中,不弹兜底提示", early.present && !early.visible, JSON.stringify(early));

  await brokenPage.waitForTimeout(8500);
  const late = await brokenPage.evaluate(() => {
    const el = document.getElementById("boot-fallback");
    if (!el || el.hidden) return { visible: false };
    const text = (el.innerText || "").replace(/\n+/g, " | ");
    const link = el.querySelector("a[href]");
    return { visible: true, text, linkText: link ? (link.textContent || "").trim() : "", linkHref: link ? link.getAttribute("href") : null };
  });
  check("脚本取不到时会给出可操作的提示(而不是永远转圈)", late.visible && /页面没能加载完/.test(late.text || ""), late.visible ? (late.text || "").slice(0, 90) : "10 秒后什么都没出现");
  check("提示里的「重新加载」是不依赖 React 的链接", late.visible && Boolean(late.linkText) && late.linkHref === "/", `href=${late.linkHref} text=${late.linkText}`);
  await broken.close();
}

// ---------- 会话中途失效:写操作失败时,界面说的是实话吗? ----------
// 实测(修之前):删掉会话后点「快速保存」,弹窗里只有一句「请先登录」——
// 弹窗停着、内容还在,而页面上**没有任何回到登录的入口**,用户只能自己猜要刷新。
{
  const prisma = new PrismaClient();
  const relogin = await loginAndConfirm(page, BASE, USER, PASS);
  check("会话过期这一段能重新登录(否则下面量的是登录页)", relogin.ok, relogin.detail);
  if (relogin.ok) {
    await dismissBlockingDialogs(page);
    const probeName = `门禁-会话过期-${Date.now().toString(36).slice(-5)}`;
    const statuses = [];
    const onResponse = (response) => { if (response.url().includes("/api/items") && response.request().method() === "POST") statuses.push(response.status()); };
    page.on("response", onResponse);
    await page.getByRole("button", { name: "录入物品" }).first().click();
    await page.waitForTimeout(900);
    await page.locator("#item-name").fill(probeName);
    const qty = page.locator('[aria-label="数量"]').first();
    if (await qty.count()) await qty.fill("2");
    // 等价于「在别的设备上改了密码」或「管理员把会话踢掉了」
    await prisma.authSession.deleteMany({});
    await page.getByRole("button", { name: /快速保存/ }).first().click({ noWaitAfter: true });
    await page.waitForTimeout(2600);
    page.off("response", onResponse);

    const ui = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const toast = document.querySelector('[role="status"]');
      return {
        dialogOpen: Boolean(dialog),
        // 整段文本都要查:错误提示在弹窗最底部,按前 200 字截断会把它切掉(第一次就是这么误判的)
        dialogHasExpiredHint: /登录/.test(dialog?.innerText || "") && /刷新|重新登录/.test(dialog?.innerText || ""),
        dialogText: ((dialog?.innerText || "").match(/[^\n]*登录[^\n]*/) || [""])[0].slice(0, 120),
        toastText: (toast?.innerText || "").replace(/\s+/g, " ").slice(0, 80),
        reloginButton: [...document.querySelectorAll("button")].some((node) => /重新登录/.test(node.textContent || "")),
      };
    });
    const created = await prisma.item.count({ where: { name: probeName } });
    check("会话失效后的写操作确实被拒(401),界面没有假装成功", statuses.includes(401) && created === 0, `状态=${statuses.join(",") || "(没拿到)"} 落库=${created}`);
    check("弹窗里的话能照做:说明登录已过期、要重新登录", ui.dialogHasExpiredHint, `命中行=${ui.dialogText || "(弹窗里没有提到登录)"}`);
    check("界面上给出了「重新登录」入口(不是让用户自己猜)", ui.reloginButton, `toast=${ui.toastText || "(没有)"} 弹窗=${ui.dialogOpen}`);

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const backToLogin = await page.evaluate(() => Boolean(document.querySelector("#auth-username")));
    check("刷新后回到登录表单", backToLogin, "刷新后仍停在应用页面");
    await prisma.item.deleteMany({ where: { name: probeName } });
  }
  await prisma.$disconnect();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);