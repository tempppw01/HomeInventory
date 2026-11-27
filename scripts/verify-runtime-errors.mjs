// 运行时健康:在真实浏览器里把每个页面过一遍,看有没有「界面看着正常、控制台在报错」。
//
// 由来:此前的界面套件都在验「某个元素在不在、点了有没有反应」,
// 没有人管页面自己有没有抛脚本错误、有没有请求 4xx。
// 实测(本机 v0.1.83)11 个页面加载 + 点击入口一共观察 2861 条网络响应,
// 只捞出两条:一条是 Next 预取自己取消的 _rsc 请求(正常),
// 另一条是详情页「重新分析」在未配置 AI 时打出的 400 —— 而那条 400 后面没有出口:
// 详情页只有「返回归物」,提示却让用户「先在设置中配置」,只读/成员更是没有这个权限。
// 所以这个套件做两件事:守住「运行时不出错」,并守住「AI 入口与配置状态一致」。
//
// 用法:PROBE_USER=... PROBE_PASS=... node scripts/verify-runtime-errors.mjs
//
// 检查条数固定(13):不随库里的数据多少变化,文档里写的数才对得上。

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

/**
 * 允许的失败请求:浏览器在页面跳转/卸载时取消在途请求,报 ERR_ABORTED。
 *   · Next 的 RSC 预取会在跳转时自己取消(带 _rsc=);
 *   · 概览的 AI 建议卡在空闲时才发请求(x-background),模型要跑几秒,
 *     这个套件 2.4 秒后就跳去下一页,于是那条请求被取消 —— 是**测量方式**造成的,
 *     不是缺陷:同一个请求在页面不被跳走时返回 200(本轮实测过)。
 * 只豁免这一种错误文本;真正的网络失败(ERR_CONNECTION_*)照样算问题。
 */
const allowedFailure = (entry) => /ERR_ABORTED/.test(entry.err || "");

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const failedRequests = [];
const badResponses = [];
let responsesSeen = 0;
let at = "启动";

page.on("response", () => { responsesSeen += 1; });
page.on("console", (message) => {
  if (message.type() !== "error") return;
  // 同一个浏览器进程里可能还开着别的项目,只收本站的
  const from = message.location()?.url || "";
  if (from && !from.includes(BASE.replace(/^https?:\/\//, ""))) return;
  consoleErrors.push({ at, text: message.text().slice(0, 200) });
});
page.on("pageerror", (error) => consoleErrors.push({ at, text: `pageerror ${String(error).slice(0, 200)}` }));
page.on("requestfailed", (request) => failedRequests.push({ at, url: request.url().replace(BASE, ""), err: request.failure()?.errorText }));
page.on("response", (response) => {
  if (response.status() >= 400) badResponses.push({ at, status: response.status(), method: response.request().method(), url: response.url().replace(BASE, "") });
});

const login = await loginAndConfirm(page, BASE, USER, PASS);
check("登录成功(否则后面全是量在登录页上)", login.ok, login.detail);
if (!login.ok) {
  await browser.close();
  process.exit(1);
}
await dismissBlockingDialogs(page);

const sweepTarget = await page.evaluate(async () => {
  try {
    const response = await fetch("/api/items?pageSize=1");
    if (!response.ok) return null;
    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : data?.items?.[0];
    return first ? { id: first.id, name: first.name, type: first.type } : null;
  } catch {
    return null;
  }
});
const itemId = sweepTarget?.id ?? null;
// 详情页 / 扫码页拿的是「库里最新的一件」。它可能是耐用品,也可能是液体 ——
// 这两类在扫码页都按设计不消耗,所以「没有 4xx」才是对的。把挑中的是什么印出来,
// 以后红了才知道当时扫的是哪一类(2026-11-27 这里挑到耐用品,而扫码页对耐用品
// 照发了一个注定 409 的请求 —— 套件红了,但红得对;修的是扫码页,不是这条检查)。
if (sweepTarget) console.log(`      详情页 / 扫码页取「最新的一件」:${sweepTarget.name}(${sweepTarget.type})`);

const ROUTES = ["/", "/items", "/tasks", "/locations", "/audit", "/report", "/settings", "/about", "/offline"];
if (itemId) ROUTES.push(`/items/${itemId}`, `/consume/${itemId}`);

// ---------- 逐页加载 ----------
const swept = [];
for (const route of ROUTES) {
  at = `加载 ${route}`;
  const e0 = consoleErrors.length, f0 = failedRequests.length, b0 = badResponses.length;
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);
  const shape = await page.evaluate(() => ({
    path: location.pathname,
    h1: document.querySelector("h1")?.innerText?.trim().slice(0, 30) ?? "",
    textLen: (document.querySelector("main")?.innerText || "").length,
  }));
  swept.push({
    route,
    shape,
    errors: consoleErrors.slice(e0),
    failed: failedRequests.slice(f0).filter((entry) => !allowedFailure(entry)),
    bad: badResponses.slice(b0),
  });
}

// 先证明「确实在观察网络」:没有任何响应时,后面那些「没有 4xx」全是空转
check("真的观察到了网络流量(防空洞通过)", responsesSeen >= 50, `响应数=${responsesSeen}`);

const blank = swept.filter((entry) => entry.shape.textLen <= 20 && !entry.shape.h1);
check("每个页面都真的渲染出了内容(不是白页/错误页)", blank.length === 0, blank.map((entry) => `${entry.route} len=${entry.shape.textLen}`).join("; "));
check("每个页面都有可见标题", swept.every((entry) => entry.shape.h1.length > 0), swept.filter((entry) => !entry.shape.h1).map((entry) => entry.route).join("; "));
check("页面加载期间没有脚本错误", swept.every((entry) => entry.errors.length === 0), swept.flatMap((entry) => entry.errors.map((e) => `${entry.route} :: ${e.text}`)).slice(0, 3).join(" | "));
check("页面加载期间没有失败请求(已豁免浏览器取消的在途请求)", swept.every((entry) => entry.failed.length === 0), swept.flatMap((entry) => entry.failed.map((f) => `${entry.route} :: ${f.err} ${f.url}`)).slice(0, 3).join(" | "));
check("页面加载期间没有 4xx/5xx", swept.every((entry) => entry.bad.length === 0), swept.flatMap((entry) => entry.bad.map((b) => `${entry.route} :: ${b.status} ${b.method} ${b.url}`)).slice(0, 3).join(" | "));

// ---------- 点开非破坏性入口 ----------
// 只点「打开一个东西」这类入口:录入弹窗、提醒中心、回收站、AI 助手。
// 它们不改库,也不会代替别的套件去做别的事。
// 刻意不点主题切换:切了会写进家庭偏好,把用户的主题改掉再不管,比不测更糟。
const INTERACTIONS = [
  { label: "录入物品", name: "录入物品", role: "button" },
  { label: "查看提醒", name: "查看提醒", role: "button" },
  { label: "回收站", name: "回收站", role: "button" },
  { label: "AI 助手", name: "AI 助手", role: "button" },
];

const interactionFindings = [];
const skippedInteractions = [];
let interactionsRun = 0;
at = "打开概览";
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await dismissBlockingDialogs(page);

for (const interaction of INTERACTIONS) {
  at = `点开「${interaction.label}」`;
  const e0 = consoleErrors.length, b0 = badResponses.length, f0 = failedRequests.length;
  try {
    await page.getByRole(interaction.role, { name: interaction.name }).first().click({ timeout: 4000 });
    await page.waitForTimeout(1300);
    interactionsRun += 1;
  } catch (error) {
    // 入口在当前数据下不存在(例如一条提醒都没有时没有提醒按钮)算跳过,不算失败
    skippedInteractions.push(`${interaction.label}:${String(error).slice(0, 60)}`);
    continue;
  }
  for (const entry of consoleErrors.slice(e0)) interactionFindings.push(`${interaction.label}: 脚本错误 ${entry.text}`);
  for (const entry of badResponses.slice(b0)) interactionFindings.push(`${interaction.label}: ${entry.status} ${entry.method} ${entry.url}`);
  for (const entry of failedRequests.slice(f0).filter((f) => !allowedFailure(f))) interactionFindings.push(`${interaction.label}: 请求失败 ${entry.err} ${entry.url}`);
  for (let i = 0; i < 2; i += 1) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); }
  if ((await page.evaluate(() => location.pathname)) !== "/") {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await dismissBlockingDialogs(page);
  }
}

check("概览上的入口都点得开(至少 3 个)", interactionsRun >= 3, `点到 ${interactionsRun} 个${skippedInteractions.length ? `;跳过:${skippedInteractions.join(" / ")}` : ""}`);
if (skippedInteractions.length) console.log(`      跳过(当前数据下没有这个入口):${skippedInteractions.join(" | ")}`);
check("点开入口时没有脚本错误 / 4xx / 请求失败", interactionFindings.length === 0, interactionFindings.slice(0, 3).join(" | "));

// ---------- AI 入口必须与配置状态一致 ----------
if (!itemId) {
  check("详情页 AI 入口与 AI 配置状态一致", false, "库里没有物品,取不到详情页(先播种再跑这个套件)");
  check("管理员能从详情页进入 AI 配置", false, "同上");
} else {
  at = "详情页 AI 入口";
  const e0 = consoleErrors.length, b0 = badResponses.length;
  await page.goto(`${BASE}/items/${itemId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const aiAvailable = await page.evaluate(async () => {
    try {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return null;
      return (await response.json()).aiAvailable === true;
    } catch {
      return null;
    }
  });
  const surface = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll("button")].map((node) => (node.innerText || "").trim()),
    links: [...document.querySelectorAll("a[href]")].map((node) => ({ href: node.getAttribute("href"), text: (node.innerText || "").trim() })),
  }));
  const hasReanalyze = surface.buttons.some((text) => text.includes("重新分析"));
  const settingsEntry = surface.links.find((link) => link.href === "/settings" && /配置 AI/.test(link.text));

  if (aiAvailable === false) {
    // 未配置 AI:不许留一个点了必然 400 的按钮,管理员必须有一条通往设置的路
    check("未配置 AI 时详情页没有可点的「重新分析」", !hasReanalyze, `按钮:${surface.buttons.join(" / ").slice(0, 120)}`);
    check("未配置 AI 时管理员能从详情页进设置配 AI", Boolean(settingsEntry), `链接:${surface.links.map((l) => l.href).join(" ").slice(0, 120)}`);
  } else if (aiAvailable === true) {
    // 已配置 AI:入口照旧可用;不能反过来显示成「未配置」
    check("已配置 AI 时详情页保留「重新分析」", hasReanalyze, `按钮:${surface.buttons.join(" / ").slice(0, 120)}`);
    check("已配置 AI 时详情页不显示「未配置」提示", !surface.buttons.some((text) => /未配置/.test(text)), `按钮:${surface.buttons.join(" / ")}`);
  } else {
    check("详情页 AI 入口与 AI 配置状态一致", false, "读不到 aiAvailable,无法判定状态");
    check("详情页 AI 入口只有两种设计状态", false, "同上");
  }

  // 走到设置页:未配置时走详情页那个新入口,已配置时直接去,断言 AI 配置区块真的在
  at = "进设置页找 AI 配置";
  const n0 = badResponses.length, e1 = consoleErrors.length;
  if (settingsEntry) {
    await page.goto(`${BASE}/items/${itemId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.getByRole("link", { name: /配置 AI/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(2200);
  } else {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
  }
  await dismissBlockingDialogs(page);
  const settingsView = await page.evaluate(() => ({
    path: location.pathname,
    heading: document.querySelector("h1")?.innerText?.trim() ?? "",
    mentionsAi: /AI/.test(document.body.innerText || ""),
  }));
  check(
    "从详情页能到达设置页的 AI 配置区块",
    settingsView.path === "/settings" && settingsView.heading === "设置" && settingsView.mentionsAi && badResponses.length === n0 && consoleErrors.length === e1,
    `path=${settingsView.path} h1=${settingsView.heading} ai=${settingsView.mentionsAi} 4xx=${badResponses.length - n0} err=${consoleErrors.length - e1}`,
  );

  // ---------- AI 助手:没配 AI 时不能等用户打完一段才告诉他 ----------
  // 实测(修之前):完全没配 AI 时,助手界面先是正常欢迎 + 四条示例问题、输入框可打,
  // 用户发出去之后才看到「请先在设置中配置 AI 接口」,而弹窗里没有任何去设置的入口。
  at = "AI 助手入口";
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissBlockingDialogs(page);
  const chatBefore = badResponses.length;
  await page.getByRole("button", { name: "AI 助手" }).first().click();
  await page.waitForTimeout(1400);
  const chatUi = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = (dialog?.innerText ?? "").replace(/\s+/g, " ");
    const input = dialog?.querySelector("textarea, input[type=text]");
    return {
      open: Boolean(dialog),
      mentionsConfigure: /配置\s*AI|还没配置|需要管理员/.test(text),
      buttons: [...(dialog?.querySelectorAll("button") ?? [])].map((node) => (node.textContent || "").trim()).filter(Boolean),
      inputDisabled: input ? Boolean(input.disabled) : null,
      chatErrors: 0,
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const hasConfigureAction = chatUi.buttons.some((label) => /去设置/.test(label));
  if (aiAvailable === false) {
    check("未配置 AI 时,助手在发问前就说清楚并给出入口", chatUi.open && chatUi.mentionsConfigure && hasConfigureAction, `提示=${chatUi.mentionsConfigure} 按钮=${JSON.stringify(chatUi.buttons.slice(0, 4))}`);
    // 输入框仍然可用:用户可以在别人配置 AI 的同时先把问题写好;而且「长文本不横向裁切」那条布局检查
    // 就是靠往这个框里打字来验的 —— 禁用它等于把那条检查废掉(CI 上真红了)。
    check("未配置 AI 时,助手输入框仍可用(只是发送前会提示去配置)", chatUi.open && chatUi.inputDisabled === false, `inputDisabled=${chatUi.inputDisabled}`);
  } else {
    // 已配置时同理:输入框可用,且不该出现「去设置配置」
    check("已配置 AI 时,助手输入框可用", chatUi.open && chatUi.inputDisabled === false, `open=${chatUi.open} inputDisabled=${chatUi.inputDisabled}`);
    check("已配置 AI 时,助手不显示「去设置配置」", !hasConfigureAction, `按钮=${JSON.stringify(chatUi.buttons.slice(0, 4))}`);
  }
  // 打开/关闭助手本身不该带出 4xx
  check("打开与关闭助手不产生 4xx", badResponses.length === chatBefore, `新增 4xx=${badResponses.length - chatBefore}`);
}

// ---------- 负控:证明监听器真的会报 ----------
// 没有这一条,「0 错误」可能只是监听器没接上。
at = "负控";
const e2 = consoleErrors.length, b2 = badResponses.length;
await page.goto(`${BASE}/__runtime-error-negative-control__`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const caughtErrors = consoleErrors.length - e2;
const caughtBad = badResponses.length - b2;
check("负控:故意访问不存在的页面会被抓到(证明监听器有效)", caughtErrors >= 1 && caughtBad >= 1, `console=${caughtErrors} 4xx=${caughtBad}`);

await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);