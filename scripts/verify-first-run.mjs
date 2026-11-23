// 首次使用这条旅程的回归 —— 此前没有任何检查。
//
// 背景:一个刚装好归物的人,打开应用看到的是「欢迎使用」那张卡,里面给了三个起点
// (录入一件物品 / 建一个家庭空间 / 写一条购物清单)和一个「我先随便看看」。
// 这条路径此前从来没被任何套件走过,而它是**每个新用户唯一会走的路**:
// 入口点不动、点了没反应、关不掉、或者看过之后每次开都再弹 —— 都会直接毁掉第一次体验。
//
// 这一版把实测确认过的行为钉住(全部为真,来自 v0.1.36 上的一次手工探测):
//   1 未看过时会出现,「暂时跳过」或「我先随便看看」之后写入本地标记,再刷新不再出现;
//   2 三个入口分别打开「录入新物品」「添加家庭空间」「添加采购项」;
//   3 焦点会进入弹层,Tab 若干次仍然留在弹层里(焦点陷阱),Escape 能关掉。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-first-run.mjs

import { launchChromium } from "./lib/browser.mjs";
import { loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const SEEN_KEY = "home-inventory-welcome-seen";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  process.exit(1);
}

const guideVisible = () => page.evaluate((key) => ({
  open: Boolean(document.querySelector('[role="dialog"][aria-label="欢迎使用"]')),
  seenKey: localStorage.getItem(key),
}), SEEN_KEY);

/** 把「看过引导」的标记清掉,并刷新到引导出现 */
const showGuide = async () => {
  await page.evaluate((key) => localStorage.removeItem(key), SEEN_KEY);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  // 只请走「提醒中心」——**不能**用 dismissBlockingDialogs:它会点掉「暂时跳过欢迎引导」,
  // 把要测的东西自己关掉(第一次跑就是这么红的)。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const notice = page.locator('[role="dialog"][aria-label="提醒中心"]:visible').first();
    if ((await notice.count()) === 0) break;
    const close = notice.locator('button[aria-label^="关闭"]').first();
    if (await close.count()) await close.click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
  }
  return guideVisible();
};

// ---------- 1 会出现,并且只出现一次 ----------
const first = await showGuide();
check("没看过引导时会出现(否则这一节没测到东西)", first.open, JSON.stringify(first));

// ---------- 2 三个入口都能打开对应的东西 ----------
const entries = [
  { button: "录入一件物品", expect: "录入新物品" },
  { button: "建一个家庭空间", expect: "添加家庭空间" },
  { button: "写一条购物清单", expect: "添加采购项" },
];
for (const entry of entries) {
  await showGuide();
  const target = page.locator(`[role="dialog"][aria-label="欢迎使用"] button`).filter({ hasText: entry.button }).first();
  const canFind = (await target.count()) > 0;
  check(`引导里有「${entry.button}」入口`, canFind, "没找到这个入口");
  if (!canFind) continue;
  await target.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1400);
  const opened = await page.evaluate((label) => Boolean(document.querySelector(`[role="dialog"][aria-label="${label}"]`)), entry.expect);
  check(`点「${entry.button}」打开「${entry.expect}」`, opened, `没有出现 aria-label=${entry.expect} 的弹窗`);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
}

// ---------- 3 焦点管理:进得去、留得住、关得掉 ----------
await showGuide();
const focusState = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="欢迎使用"]');
  const active = document.activeElement;
  return { inside: Boolean(dialog && active && dialog.contains(active)), focusable: dialog ? dialog.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])').length : 0 };
});
check("打开时焦点在引导弹层里(键盘用户不会落在背后的页面上)", focusState.inside, JSON.stringify(focusState));

const wander = [];
for (let i = 0; i < 8; i += 1) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(120);
  wander.push(await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="欢迎使用"]');
    const active = document.activeElement;
    return Boolean(dialog && active && dialog.contains(active));
  }));
}
check("Tab 一圈之后焦点仍然留在弹层里(焦点陷阱)", wander.every(Boolean), `每步是否在弹层内:${wander.map((v) => (v ? "是" : "否")).join(",")}`);

await page.keyboard.press("Escape");
await page.waitForTimeout(800);
const closed = await guideVisible();
check("Escape 能关掉引导", !closed.open, JSON.stringify(closed));
check("关掉之后写入了本地标记(下次不再打扰)", Boolean(closed.seenKey), `标记值=${closed.seenKey ?? "(空)"}`);

// ---------- 4 已经看过就不再出现 ----------
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
const second = await guideVisible();
check("看过之后刷新不再出现", !second.open, JSON.stringify(second));

// 收尾:把标记还原成「看过了」,免得留下一个每次开都会弹引导的浏览器状态
await page.evaluate((key) => localStorage.setItem(key, "seen"), SEEN_KEY);
await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);