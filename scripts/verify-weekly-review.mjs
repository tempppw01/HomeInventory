// 「每周盘点」提醒的界面验收。
//
// 这个偏好此前是死开关:能存、能在设置里改、接口也返回,但没有任何地方消费它 ——
// 打开之后什么都不会发生。现在它决定提醒中心是否给出「开始盘点」入口,这里盯住这条链路。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-weekly-review.mjs

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

const setPreference = (patch) => page.evaluate(async (body) => {
  const response = await fetch("/api/settings/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.status;
}, patch);

/** 打开提醒中心,返回其文字 */
const openReminderCenter = async () => {
  await page.goto(BASE);
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);
  const bell = page.locator('button[aria-label*="提醒"]').first();
  if ((await bell.count()) === 0) return null;
  await bell.click();
  await page.waitForTimeout(1400);
  return page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getBoundingClientRect().height > 0);
    if (!dialogs.length) return null;
    return (dialogs[dialogs.length - 1].innerText || "").replace(/\n+/g, " | ");
  });
};

const today = new Date().getDay();
const otherDay = (today + 3) % 7;

// ① 设定日 = 今天 → 提醒中心给出入口
{
  const status = await setPreference({ weeklyReviewEnabled: true, weeklyReviewDay: today });
  check("能保存「每周盘点」偏好", status === 200, `status=${status}`);

  const text = await openReminderCenter();
  check("设定日当天,提醒中心出现盘点入口", Boolean(text) && /每周盘点日/.test(text), text ? text.slice(0, 120) : "没打开提醒中心");

  // ② 点「开始盘点」应进入盘点页
  if (text && /每周盘点日/.test(text)) {
    const clicked = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => (node.textContent || "").trim() === "开始盘点");
      if (!button) return false;
      button.click();
      return true;
    });
    check("有「开始盘点」按钮", clicked, "没找到按钮");
    if (clicked) {
      await page.waitForTimeout(2200);
      const state = await page.evaluate(() => ({ url: location.pathname, text: (document.querySelector("main")?.innerText || "").slice(0, 60) }));
      check("点击后进入盘点页", state.url === "/audit", `当前=${state.url}`);
    }
  }
}

// ③ 设定日不是今天 → 入口不出现(这个开关真的在起作用)
{
  await setPreference({ weeklyReviewEnabled: true, weeklyReviewDay: otherDay });
  const text = await openReminderCenter();
  check("不是设定日时,入口不出现", Boolean(text) && !/每周盘点日/.test(text), text ? text.slice(0, 120) : "没打开提醒中心");
}

// ④ 关掉开关 → 即使撞上设定日也不出现
{
  await setPreference({ weeklyReviewEnabled: false, weeklyReviewDay: today });
  const text = await openReminderCenter();
  check("关掉开关后不出现", Boolean(text) && !/每周盘点日/.test(text), text ? text.slice(0, 120) : "没打开提醒中心");
}

// 恢复默认(开启、周日)
await setPreference({ weeklyReviewEnabled: true, weeklyReviewDay: 0 });

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);