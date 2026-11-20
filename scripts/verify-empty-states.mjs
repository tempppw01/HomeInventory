// 空状态验收。
//
// 为什么单独做:界面里有好几处「空状态」文案(还没有录入物品 / 没有找到物品 /
// 暂无提醒 / 还没有安排任务),但**此前一条都没有被断言过** ——
// 它们恰恰是最容易在改版里被漏掉、又最容易被用户看到的部分。
//
// 这里只做**不依赖数据就能达到**的空状态(搜索无结果、搜索历史为空),
// 另两处(提醒中心、任务列表)按当前数据条件判断:数据不满足时打印原因,
// 不硬判失败,避免造出一条永远为绿的假检查。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-empty-states.mjs

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

const mainText = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "));
const dialogText = () => page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getBoundingClientRect().height > 0);
  return dialogs.length ? (dialogs[dialogs.length - 1].innerText || "").replace(/\n+/g, " | ") : null;
});

await page.goto(`${BASE}/items`);
await page.waitForTimeout(2800);
await dismissBlockingDialogs(page);

// ---------- ① 搜索无结果:给出明确空状态,而且状态可逆 ----------
{
  const input = page.locator('input[type="search"], input[placeholder*="搜索"]').first();
  check("物品页有搜索框", (await input.count()) > 0, "没找到搜索框");

  if ((await input.count()) > 0) {
    await input.fill("zzz-搜不到的关键词-zzz");
    await page.waitForTimeout(1700);
    const text = await mainText();
    check("搜不到时给出「没有找到物品」", /没有找到物品/.test(text), text.slice(0, 160));
    check("并告诉用户下一步怎么做", /换个关键词|筛选/.test(text), text.slice(0, 160));

    await input.fill("");
    await page.waitForTimeout(1700);
    const restored = await mainText();
    check("清空搜索后列表恢复(状态可逆)", !/没有找到物品/.test(restored), restored.slice(0, 160));
  }
}

// ---------- ② 搜索历史为空时:不弹出历史层 ----------
{
  await page.evaluate(async () => {
    await fetch("/api/search-history", { method: "DELETE" });
  });
  const input = page.locator('input[type="search"], input[placeholder*="搜索"]').first();
  if ((await input.count()) > 0) {
    await input.click();
    await page.waitForTimeout(1200);
    const text = await mainText();
    // 历史区有独立标题;为空时不该出现
    check("没有搜索历史时不显示历史区", !/最近搜索|搜索历史/.test(text), text.slice(0, 160));
  }
}

// ---------- ③ 提醒中心:数据为空时才出现的空状态 ----------
{
  await page.goto(BASE);
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);
  const alertCount = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const body = await response.json();
    const items = body.items ?? [];
    const now = Date.now();
    const days = (value) => Math.round((new Date(new Date(value).setHours(0, 0, 0, 0)).getTime() - new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()) / 86400000);
    const expired = items.filter((item) => item.quantity > 0 && item.type === "CONSUMABLE" && item.expiryDate && days(item.expiryDate) < 0);
    const soon = items.filter((item) => item.quantity > 0 && item.type === "CONSUMABLE" && item.expiryDate && days(item.expiryDate) >= 0 && days(item.expiryDate) <= 7);
    return expired.length + soon.length;
  });

  const bell = page.locator('button[aria-label*="提醒"]').first();
  if ((await bell.count()) === 0) {
    check("顶栏有提醒入口", false, "没找到提醒按钮");
  } else {
    await bell.click();
    await page.waitForTimeout(1400);
    const text = await dialogText();
    if (alertCount === 0) {
      check("没有待处理事项时显示「暂无提醒」", Boolean(text) && /暂无提醒/.test(text), text ? text.slice(0, 160) : "没打开提醒中心");
    } else {
      if (!text || !/暂无提醒/.test(text)) {
        console.log(`      跳过「暂无提醒」空状态:当前库里有 ${alertCount} 条待处理事项,该分支不可达`);
      } else {
        check("有事项时不应显示「暂无提醒」", false, "出现了空状态文案,说明计数与实际不一致");
      }
      check("有事项时列出具体条目", Boolean(text) && /过期|即将到期|该补货/.test(text), text ? text.slice(0, 160) : "没打开提醒中心");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
}

// ---------- ④ 任务列表:空状态按数据条件判断 ----------
{
  await page.goto(`${BASE}/tasks`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  const text = await mainText();
  // 别用 DOM 选择器猜「有没有任务」—— 任务行不是 li,第一次就是这么误判成空页面的。
  // 用页面自己的计数文案判断。
  const taskSummary = /共 \d+ 项|接下来 \d+ 天有/.test(text);
  if (/还没有安排任务/.test(text)) {
    check("任务为空时说明怎么开始", /从一次清洁|保养|开始/.test(text), text.slice(0, 160));
  } else if (taskSummary) {
    console.log("      跳过「还没有安排任务」空状态:当前有任务,该分支不可达");
  } else {
    check("任务页要么有内容、要么给出空状态", false, text.slice(0, 160));
  }
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);