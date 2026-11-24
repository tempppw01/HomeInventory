// 「库结构比应用旧」时的失败体验 —— 自建部署最常见的一种升级失误。
//
// 场景:把镜像换成新版本,却忘了同步数据库结构(本项目用 prisma db push,启动时不会自动迁移)。
// 实测(修之前)用户看到的是:
//   · 所有业务接口 500「服务器暂时开小差了,请稍后重试」—— 听起来像临时故障,会一直刷新重试;
//   · 页面直接崩成通用错误页「页面没能加载出来 / 可以重试一次」;
//   · /api/health 还是 200 {"status":"ok"} —— 监控说一切正常。
//
// 修完之后这里逐条钉住:
//   1 健康检查如实报 degraded / schema-outdated,并给出可照做的命令;
//   2 业务接口回 503 + code=SCHEMA_OUTDATED + 说明(不再是「稍后重试」);
//   3 页面显示「没能读到家里的数据」+ 那条说明 + 重新加载,**不**再崩成通用错误页;
//   4 正常库完全不受影响(否则这一套可能只是「到处都报错」而不是「认出来了」)。
//
// 两个实例必须**各自登录**:会话是各实例自己的密钥签的,借另一个实例的 cookie 会 401(实测)。
// 页面内 fetch 也只在同源可用 —— 跨端口会被 CORS 拦掉,所以每个源各开一页。
//
// 需要一个「模拟老库」的实例(CI 里是 3004:由 ci.db 复制后删掉两列)。
// 用法:BASE_URL=http://127.0.0.1:3001 BASE_OLD_URL=http://127.0.0.1:3004 PROBE_USER=... node scripts/verify-schema-outdated.mjs

import { launchChromium } from "./lib/browser.mjs";

const HEALTHY = process.env.BASE_URL || "http://127.0.0.1:3001";
const OLD = process.env.BASE_OLD_URL || "http://127.0.0.1:3004";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const getJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: response.status, json };
};

// ---------- 1 健康检查要如实 ----------
const oldHealth = await getJson(`${OLD}/api/health`);
check("老库的健康检查不再是「一切正常」", oldHealth.status === 503, `status=${oldHealth.status} body=${JSON.stringify(oldHealth.json).slice(0, 120)}`);
check("老库健康检查明确说是「结构过期」", oldHealth.json?.database === "schema-outdated" && oldHealth.json?.status === "degraded", JSON.stringify(oldHealth.json).slice(0, 160));
check("健康检查里带上了可照做的命令", /db:push/.test(String(oldHealth.json?.hint ?? "")), `hint=${oldHealth.json?.hint ?? "(无)"}`);

const healthyHealth = await getJson(`${HEALTHY}/api/health`);
check("正常库仍然报 ok(说明这一套不是「到处都报错」)", healthyHealth.status === 200 && healthyHealth.json?.status === "ok", `status=${healthyHealth.status} body=${JSON.stringify(healthyHealth.json).slice(0, 120)}`);

const browser = await launchChromium();

/** 在指定源里登录,并返回这一页(同源 fetch 才能用) */
const loggedInPage = async (origin) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const status = await page.evaluate(async (creds) => {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds) });
    return response.status;
  }, { username: USER, password: PASS });
  return { context, page, loginStatus: status };
};

// ---------- 2 老库:业务接口 ----------
const oldSession = await loggedInPage(OLD);
check("能在老库上登录(账号表是好的)", oldSession.loginStatus === 200, `POST /api/auth/login → ${oldSession.loginStatus}`);

const oldItems = await oldSession.page.evaluate(async () => {
  const response = await fetch("/api/items", { cache: "no-store" });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
});
check("老库的业务接口回 503(不再是 500「稍后重试」)", oldItems.status === 503, `status=${oldItems.status} body=${JSON.stringify(oldItems.json).slice(0, 120)}`);
check("响应里带 SCHEMA_OUTDATED 标记,便于界面识别", oldItems.json?.code === "SCHEMA_OUTDATED", JSON.stringify(oldItems.json).slice(0, 140));
check("说明是可照做的:给出命令、Docker 提示与下一步", /db:push/.test(String(oldItems.json?.error ?? "")) && /Docker/.test(String(oldItems.json?.error ?? "")) && /刷新/.test(String(oldItems.json?.error ?? "")), String(oldItems.json?.error ?? "(无)").slice(0, 160));

// ---------- 3 老库:页面 ----------
// 先清掉「看过引导」的标记:这样如果引导真的要弹,就会弹出来盖住失败态 —— 正是要测的点
await oldSession.page.evaluate(() => localStorage.removeItem("home-inventory-welcome-seen"));
await oldSession.page.goto(`${OLD}/items`, { waitUntil: "domcontentloaded" });
await oldSession.page.waitForTimeout(3200);
const pageState = await oldSession.page.evaluate(() => {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  return {
    loadFailed: Boolean(document.querySelector("[data-load-failed]")),
    genericCrash: /页面没能加载出来/.test(text),
    hasHint: /db:push/.test(text),
    hasRetry: /重新加载/.test(text),
    snippet: text.slice(0, 200),
  };
});
check("页面显示的是「没能读到家里的数据」失败态", pageState.loadFailed, pageState.snippet);
check("页面**不再**崩成通用错误页(「页面没能加载出来」)", !pageState.genericCrash, pageState.snippet);
check("页面上就能看到那条命令", pageState.hasHint, pageState.snippet);
check("失败态提供重新加载入口", pageState.hasRetry, pageState.snippet);

// ---------- 3b 引导不能盖住这条说明 ----------
const overlayState = await oldSession.page.evaluate(() => ({
  guideOpen: Boolean(document.querySelector('[role="dialog"][aria-label="欢迎使用"]')),
  failureVisible: Boolean(document.querySelector('[data-load-failed]')),
}));
check(
  "数据读不到时不弹首次使用引导(它会盖住「请先运行 db:push」这条唯一能照做的说明)",
  !overlayState.guideOpen && overlayState.failureVisible,
  JSON.stringify(overlayState),
);

// ---------- 3c 对比度与点击目标 ----------
const a11y = await oldSession.page.evaluate(() => {
  const parse = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2] };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (fg, bg) => { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const backgroundOf = (el) => {
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const view = document.querySelector('[data-load-failed]');
  const message = view?.querySelector('[data-error-source]');
  const button = view?.querySelector('button');
  const contrastOf = (el) => {
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color);
    const bg = parse(backgroundOf(el));
    return fg && bg ? Number(ratio(fg, bg).toFixed(2)) : null;
  };
  return {
    role: view ? view.getAttribute("role") : null,
    messageContrast: contrastOf(message),
    buttonContrast: contrastOf(button),
    buttonHeight: button ? Math.round(button.getBoundingClientRect().height) : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
check("失败态用 role=alert 播报(读屏用户能立刻听到)", a11y.role === "alert", JSON.stringify(a11y));
check("说明文字的对比度 ≥ 4.5:1", typeof a11y.messageContrast === "number" && a11y.messageContrast >= 4.5, `对比度=${a11y.messageContrast}`);
check("按钮文字对比度 ≥ 4.5:1 且高度 ≥ 44px", typeof a11y.buttonContrast === "number" && a11y.buttonContrast >= 4.5 && a11y.buttonHeight >= 44, JSON.stringify(a11y));
// 真的切到 320px 再量一次(之前在桌面宽度量,名不副实)
const desktopViewport = oldSession.page.viewportSize();
await oldSession.page.setViewportSize({ width: 320, height: 780 });
await oldSession.page.waitForTimeout(600);
const narrow = await oldSession.page.evaluate(() => {
  const view = document.querySelector('[data-load-failed]');
  const button = view?.querySelector('button');
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    buttonHeight: button ? Math.round(button.getBoundingClientRect().height) : null,
    viewWidth: view ? Math.round(view.getBoundingClientRect().width) : null,
  };
});
check("失败态在 320px 宽下不横向溢出", narrow.overflow <= 0, JSON.stringify(narrow));
check("320px 下按钮仍然够大(≥44px 高)", typeof narrow.buttonHeight === "number" && narrow.buttonHeight >= 44, JSON.stringify(narrow));
if (desktopViewport) await oldSession.page.setViewportSize(desktopViewport);

// ---------- 3d 键盘能到达并触发重试 ----------
let reachedTab = null;
for (let i = 0; i < 30; i += 1) {
  await oldSession.page.keyboard.press("Tab");
  const inView = await oldSession.page.evaluate(() => Boolean(document.activeElement?.closest("[data-load-failed]")));
  if (inView) { reachedTab = i + 1; break; }
}
check("键盘能 Tab 到「重新加载」", reachedTab !== null, `走了 30 步仍未到达`);
if (reachedTab !== null) {
  const retries = [];
  oldSession.page.on("request", (request) => { if (request.url().includes("/api/dashboard")) retries.push(1); });
  await oldSession.page.keyboard.press("Enter");
  await oldSession.page.waitForTimeout(2500);
  check("回车会真的再请求一次(不是个假按钮)", retries.length > 0, `请求数=${retries.length}`);
  check("重试后仍然是失败态(库结构没变就不该假装好了)", await oldSession.page.evaluate(() => Boolean(document.querySelector("[data-load-failed]"))), "失败态消失了");
}

// ---------- 4 正常库不受影响 ----------
const healthySession = await loggedInPage(HEALTHY);
await healthySession.page.goto(`${HEALTHY}/items`, { waitUntil: "domcontentloaded" });
await healthySession.page.waitForTimeout(3000);
const healthyPage = await healthySession.page.evaluate(() => {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  return {
    loadFailed: Boolean(document.querySelector("[data-load-failed]")),
    genericCrash: /页面没能加载出来/.test(text),
    hasItemsHeading: /物品与采购/.test(text),
  };
});
check("正常库的页面正常渲染(没有误进失败态)", !healthyPage.loadFailed && !healthyPage.genericCrash && healthyPage.hasItemsHeading, JSON.stringify(healthyPage));

await oldSession.context.close();
await healthySession.context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);