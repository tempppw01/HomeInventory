// 「暂停补货提醒」界面入口的验收。
//
// 这个功能此前是半成品:字段存在、客户端逻辑尊重它、接口也接受它,
// 但**界面上没有任何入口**,用户根本开不了 —— 所以这一套专门盯界面这一半。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-restock-pause-ui.mjs

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

/** 打开第一张消耗品卡片的 ⋯ 菜单,返回菜单项文字 */
const openMenu = async () => {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  await page.locator('main button[aria-label="更多操作"]').first().click({ button: "right" });
  await page.waitForTimeout(900);
  return page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map((node) => (node.textContent || "").trim()));
};

/** 当前处于暂停期的物品名 */
const pausedNames = () => page.evaluate(async () => {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  const body = await response.json();
  return (body.items ?? [])
    .filter((item) => item.restockPausedUntil && new Date(item.restockPausedUntil).getTime() > Date.now())
    .map((item) => item.name);
});

const clickMenu = (text) => page.evaluate((needle) => {
  const node = Array.from(document.querySelectorAll('[role="menuitem"]')).find((entry) => (entry.textContent || "").includes(needle));
  if (!node) return false;
  node.click();
  return true;
}, text);

// 先确保没有残留的暂停状态
{
  const before = await pausedNames();
  if (before.length) {
    await openMenu();
    if (before.length) {
      await clickMenu("恢复补货提醒");
      await page.waitForTimeout(2200);
    }
  }
}

// ① 菜单里有入口
{
  const items = await openMenu();
  check("卡片菜单里有「暂停补货提醒」入口", items.some((entry) => entry.includes("暂停补货提醒")), `菜单=${items.join("/")}`);
}

// ② 点击后真的写入了暂停期(不是只有提示)
{
  const paused = await openMenu();
  if (!paused.some((entry) => entry.includes("暂停补货提醒"))) {
    check("点击后物品进入暂停期", false, "菜单里没有该入口");
  } else {
    await clickMenu("暂停补货提醒");
    await page.waitForTimeout(2600);
    const names = await pausedNames();
    check("点击后物品进入暂停期(数据已写入)", names.length > 0, `暂停中的物品=${names.join(",") || "无"}`);

    const feedback = await page.evaluate(() => /已暂停补货提醒/.test(document.body.innerText));
    check("给出了可见反馈", feedback, "没有看到提示文字");
  }
}

// ③ 再次打开菜单变成「恢复」,且点击后暂停期被清掉
{
  const items = await openMenu();
  check("暂停后菜单变成「恢复补货提醒」", items.some((entry) => entry.includes("恢复补货提醒")), `菜单=${items.join("/")}`);

  if (items.some((entry) => entry.includes("恢复补货提醒"))) {
    await clickMenu("恢复补货提醒");
    await page.waitForTimeout(2600);
    const names = await pausedNames();
    check("恢复后暂停期被清掉", names.length === 0, `仍在暂停=${names.join(",")}`);
  }
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);