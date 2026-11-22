// 嵌套控件扫描:HTML 不允许把控件放进控件里。
//
// 为什么单独成一套:提醒中心那一行既是按钮(onClick 进编辑),右边又放了一个
// 「处理掉」按钮,渲染出来是 <button> 里套 <button> ——
//   · React 直接报 hydration 错误(控制台每次挂载都报);
//   · 点「处理掉」会冒泡触发整行的 onClick:「移入回收站」的二次确认
//     和「编辑物品」两个弹窗一起弹出来;
//   · 读屏只会听到一个控件,内层按钮既没有名字也没法 Tab 到。
// 这类问题**不报错、不崩溃**,只看截图看不出来,所以必须用断言钉住:
//   1 每个视图 / 弹窗里都没有「控件套控件」
//   2 打开提醒中心的全过程控制台零报错(hydration 错误的哨兵)
//   3 点「处理掉」只弹一个确认框,不会再冒出「编辑物品」
//   4 概览「最近更新」行的两个图标快捷键是真按钮、有名、可 Tab(此前是 <span onClick>)
//   5 盘点核对表每行带 aria-pressed(此前「已确认」只有底色,读屏读不到)
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-nested-controls.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const VIEWS = ["/", "/items", "/tasks", "/locations", "/audit", "/settings", "/about", "/report"];

// 控件选择器:凡是「用户能操作的东西」都算。
const INTERACTIVE = [
  "button", "a[href]", "select", "textarea",
  'input:not([type="hidden"])',
  '[role="button"]', '[role="link"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', '[role="slider"]', '[role="option"]',
].join(", ");

// 外层只可能是这些东西:label 包里放 input 是合法写法,不能算。
const OUTER = ['button', "a[href]", '[role="button"]', '[role="link"]'].join(", ");

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// 控制台报错一律记账:hydration 错误正是从这里冒出来的。
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const text = message.text();
  // dev 模式的 HMR 传输错误与产品无关(CI 跑的是 next start,没有这一条)。
  if (/_next\/webpack-hmr|ERR_INVALID_HTTP_RESPONSE|Download the React DevTools/.test(text)) return;
  consoleErrors.push(text.replace(/\s+/g, " ").slice(0, 200));
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).replace(/\s+/g, " ").slice(0, 200)}`));

// 登录。这里没有直接用 lib/probe-auth 的 loginAndConfirm:
// 应用启动时会先显示「正在检查账号状态...」,此时登录表单还没出现在 DOM 里。
// loginAndConfirm 只等 1.8 秒就问「有没有登录表单」,开发服务器首次编译页面时
// 必然还没到 —— 它会把「还在加载」当成「已经登录」,后面每条断言都量在登录页上却全绿。
// (本套件第一次就是这样:9/14 通过,而失败原因全是没登录。)
const waitForSurface = async (timeout = 25000) => {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      login: Boolean(document.querySelector("#auth-username")),
      shell: (document.querySelector("main")?.innerText || "").trim().length > 10,
    }));
    if (last.login || last.shell) return last;
    await page.waitForTimeout(400);
  }
  return last ?? { login: false, shell: false };
};

async function signIn() {
  await page.goto(BASE);
  let state = await waitForSurface();
  if (!state.login && state.shell) return { ok: true, detail: "复用已有会话" };
  if (!state.login) return { ok: false, detail: "等不到登录表单,也没等到应用界面" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.fill("#auth-username", USER);
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2600);
    state = await waitForSurface(15000);
    if (!state.login && state.shell) return { ok: true, detail: "已进入应用" };
    const limited = await page.evaluate(() => /频繁|稍后再试|too many/i.test(document.body.innerText || ""));
    if (limited) {
      console.log("      登录被限速,等 20 秒重试");
      await page.waitForTimeout(20000);
    }
  }
  return { ok: false, detail: "登录后仍停在登录页 —— 账号密码可能已失效或被限速" };
}

const auth = await signIn();
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  process.exit(1);
}

/** 扫当前页面里所有「控件套控件」。 */
const nestingHits = () => page.evaluate(({ outer, inner }) => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return getComputedStyle(element).visibility !== "hidden";
  };
  const describe = (element) => {
    const name = element.getAttribute("aria-label") || (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return `${element.tagName}${name ? `「${name}」` : ""}`;
  };
  const hits = [];
  document.querySelectorAll(outer).forEach((node) => {
    if (!visible(node)) return;
    const inside = Array.from(node.querySelectorAll(inner)).filter(visible);
    if (!inside.length) return;
    hits.push({ outer: describe(node), inner: inside.map(describe), outerClass: (node.getAttribute("class") || "").slice(0, 90) });
  });
  return hits;
}, { outer: OUTER, inner: INTERACTIVE });

const formatHits = (hits) => hits.map((hit) => `${hit.outer} ⊃ ${hit.inner.join(" / ")}`).join(" ; ");

let scanned = 0;

for (const route of VIEWS) {
  await page.goto(BASE + route);
  await page.waitForTimeout(2200);
  await dismissBlockingDialogs(page);
  await page.waitForTimeout(400);
  const hits = await nestingHits();
  scanned += 1;
  check(`${route}:没有控件套控件`, hits.length === 0, formatHits(hits));
}

// 物品详情页(带 AI 卡片、二维码、编辑入口,结构最复杂的一个页面)
const itemId = await page.evaluate(async () => {
  try {
    const response = await fetch("/api/items", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    const list = Array.isArray(payload) ? payload : payload.items || [];
    return list[0]?.id ?? null;
  } catch {
    return null;
  }
});
if (itemId) {
  await page.goto(`${BASE}/items/${itemId}`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  const hits = await nestingHits();
  scanned += 1;
  check("/items/[id]:没有控件套控件", hits.length === 0, formatHits(hits));
} else {
  check("/items/[id]:拿到物品 id", false, "接口没有返回任何物品");
}

// 概览「最近更新」行的两个图标快捷键:必须是真按钮、有名、能 Tab 到。
await page.goto(BASE + "/");
await page.waitForTimeout(2400);
await dismissBlockingDialogs(page);
const recentShortcuts = await page.evaluate(() => {
  const row = document.querySelector('[data-testid="recent-list"]');
  if (!row) return null;
  const firstRow = row.querySelector("button");
  if (!firstRow) return null;
  const scope = firstRow.closest("div") || row;
  const icons = Array.from(scope.querySelectorAll("button")).filter((node) => node !== firstRow);
  return icons.map((node) => ({
    tag: node.tagName,
    name: (node.getAttribute("aria-label") || "").trim(),
    focusable: node.tabIndex >= 0,
    w: Math.round(node.getBoundingClientRect().width),
    h: Math.round(node.getBoundingClientRect().height),
  }));
});
if (!recentShortcuts || recentShortcuts.length === 0) {
  check("概览最近更新:两个图标快捷键存在", false, "找不到行内快捷键(物品列表为空?)");
} else {
  const allButtons = recentShortcuts.every((entry) => entry.tag === "BUTTON");
  const allNamed = recentShortcuts.every((entry) => entry.name.length > 0);
  const allFocusable = recentShortcuts.every((entry) => entry.focusable);
  const bigEnough = recentShortcuts.every((entry) => entry.w >= 28 && entry.h >= 28);
  check("概览最近更新:图标快捷键是真按钮(不是 <span onClick>)", allButtons, JSON.stringify(recentShortcuts));
  check("概览最近更新:图标快捷键有可访问名", allNamed, JSON.stringify(recentShortcuts));
  check("概览最近更新:图标快捷键能 Tab 到", allFocusable, JSON.stringify(recentShortcuts));
  check("概览最近更新:图标快捷键不小于 28px", bigEnough, JSON.stringify(recentShortcuts));
}

// 盘点核对表:「已确认」要能被读屏读到,不能只有底色。
await page.goto(BASE + "/audit");
await page.waitForTimeout(2400);
await dismissBlockingDialogs(page);
const auditRows = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll("section, div")).find((node) => /核对表/.test(node.textContent || "") && node.querySelector("button"));
  const scope = table || document.body;
  const buttons = Array.from(scope.querySelectorAll("button")).filter((node) => node.closest("li") || node.className.includes("border-t"));
  return buttons.slice(0, 12).map((node) => ({ name: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20), pressed: node.getAttribute("aria-pressed") }));
});
const auditWithState = auditRows.filter((row) => row.pressed === "false" || row.pressed === "true").length;
check("盘点核对表:每行都带 aria-pressed 状态", auditRows.length > 0 && auditWithState === auditRows.length, `带状态的 ${auditWithState}/${auditRows.length}`);

// 提醒中心:打开 → 扫描 → 点「处理掉」只应弹出一个确认框。
await page.goto(BASE + "/items");
await page.waitForTimeout(2400);
await dismissBlockingDialogs(page);
const bell = page.locator('button[aria-label="查看提醒"]').first();
if ((await bell.count()) === 0) {
  check("提醒中心:能找到入口", false, "顶栏没有「查看提醒」按钮");
} else {
  await bell.click();
  await page.waitForTimeout(1200);
  const openLabels = () => page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter((node) => node.getBoundingClientRect().height > 0)
    .map((node) => node.getAttribute("aria-label") || (node.innerText || "").split("\n")[0]));
  const opened = await openLabels();
  check("提醒中心:能打开", opened.some((label) => /提醒中心/.test(label || "")), `当前弹窗:${opened.join(" / ")}`);

  const hits = await nestingHits();
  check("提醒中心:没有控件套控件", hits.length === 0, formatHits(hits));

  const dispose = page.locator('[role="dialog"] button:has-text("处理掉")').first();
  if ((await dispose.count()) === 0) {
    check("提醒中心:有到期物品可测试「处理掉」", false, "库里没有已过期物品,这条用例等于没测");
  } else {
    await dispose.click();
    await page.waitForTimeout(1000);
    const afterDispose = await openLabels();
    const stacked = afterDispose.filter((label) => /编辑物品/.test(label || "")).length;
    check("点「处理掉」不会连带打开「编辑物品」", stacked === 0, `同时打开的弹窗:${afterDispose.join(" / ")}`);
    check("点「处理掉」只弹出一个确认框", afterDispose.filter((label) => /移入回收站/.test(label || "")).length === 1, `当前弹窗:${afterDispose.join(" / ")}`);
    // 取消掉,别真的把物品移走
    const cancel = page.locator('[role="dialog"] button:has-text("取消")').first();
    if (await cancel.count()) await cancel.click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
}

// 回收站:行里带恢复/彻底删除按钮,是另一处容易踩嵌套的列表
await page.goto(BASE + "/items");
await page.waitForTimeout(2200);
await dismissBlockingDialogs(page);
const recycle = page.locator('button[aria-label="回收站"]').first();
if (await recycle.count()) {
  await recycle.click();
  await page.waitForTimeout(1200);
  const hits = await nestingHits();
  check("回收站:没有控件套控件", hits.length === 0, formatHits(hits));
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
}

check("全程控制台零报错(嵌套按钮会以 hydration 错误的形式出现在这里)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await context.close();
await browser.close();

console.log(`\n扫了 ${scanned} 个视图 + 提醒中心 / 回收站`);
const failed = results.filter((entry) => !entry.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);
