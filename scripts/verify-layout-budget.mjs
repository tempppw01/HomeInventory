// 布局预算检查:把「按钮挤压阅读区」这类问题量化成阈值。
//
// 由来:用户反馈「小视图下按钮过大会遮挡元素、或让阅读范围收窄」。
// 修完之后,需要一道防线 —— 否则下次有人把图标按钮放大到 44px,同样的问题会悄悄回来,
// 而常规断言(元素存在、可点击)完全看不出来。
//
// 检查的是「占比」而不是像素:不同机型、不同字号下都能用同一套标准。
// 阈值取实测值再留约 5~8 个百分点的余量 —— 既能容忍细微差异,又能拦住明显退化。

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

// 每个视口的最低占比(百分比)
const BUDGETS = [
  { width: 320, height: 568, chatTitle: 50, insightsText: 60, cardText: 65 },
  { width: 390, height: 844, chatTitle: 57, insightsText: 68, cardText: 72 },
  { width: 1280, height: 900, chatTitle: 50, insightsText: 68, cardText: 52 },
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("布局预算检查已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  process.exit(1);
}

const measure = async ({ width, height }) => {
  await page.setViewportSize({ width, height });

  // ① 概览:等待 AI 建议卡片(它在异步加载,不等就会测到空)
  await page.goto(BASE);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  let aiAvailable = false;
  for (let i = 0; i < 8; i += 1) {
    const state = await page.evaluate(async () => {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const body = response.ok ? await response.json() : {};
      const li = document.querySelector('[aria-label="AI 本周建议"] li');
      return { aiAvailable: Boolean(body.aiAvailable), hasCard: Boolean(li) };
    });
    aiAvailable = state.aiAvailable;
    if (!aiAvailable || state.hasCard) break;
    await page.waitForTimeout(3000);
  }

  const insights = await page.evaluate(() => {
    const li = document.querySelector('[aria-label="AI 本周建议"] li');
    if (!li) return null;
    const text = li.querySelector("b")?.parentElement;
    if (!text) return null;
    return {
      liWidth: Math.round(li.getBoundingClientRect().width),
      textWidth: Math.round(text.getBoundingClientRect().width),
    };
  });

  // ② 助手面板:标题可用宽度占比(按钮占太多就会掉下来)
  let chat = null;
  const launcher = page.locator('button[aria-label="打开归物助手"]').last();
  if (await launcher.count()) {
    await launcher.click();
    await page.waitForTimeout(1500);
    chat = await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => (node.getAttribute("aria-label") || "").includes("归物助手"));
      if (!panel) return null;
      const panelWidth = panel.getBoundingClientRect().width;
      const title = panel.querySelector("h2")?.getBoundingClientRect();
      return title ? { panelWidth: Math.round(panelWidth), titleWidth: Math.round(title.width) } : null;
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ③ 物品卡片:正文可用宽度占比(「用掉」等按钮占多少)
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);
  const card = await page.evaluate(() => {
    const consume = Array.from(document.querySelectorAll("main button")).find((button) => (button.getAttribute("aria-label") || "").startsWith("用掉"));
    if (!consume) return null;
    let root = consume;
    for (let up = 0; up < 8 && root.parentElement; up += 1) {
      root = root.parentElement;
      if (String(root.className).includes("surface")) break;
    }
    const cardWidth = root.getBoundingClientRect().width;
    const buttonsWidth = Array.from(root.querySelectorAll("button")).reduce((sum, button) => sum + button.getBoundingClientRect().width, 0);
    const nameWidth = root.querySelector("button")?.getBoundingClientRect().width ?? 0;
    return { cardWidth, buttonsWidth, nameWidth };
  });

  const horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  return {
    insights: insights && insights.liWidth ? Math.round((insights.textWidth / insights.liWidth) * 100) : null,
    chatTitle: chat && chat.panelWidth ? Math.round((chat.titleWidth / chat.panelWidth) * 100) : null,
    cardText: card && card.cardWidth ? Math.round(((card.cardWidth - card.buttonsWidth + card.nameWidth) / card.cardWidth) * 100) : null,
    horizontalScroll,
    aiAvailable,
  };
};

console.log("\n视口          助手标题占比   AI 建议正文占比   卡片正文占比   横向滚动");
for (const budget of BUDGETS) {
  const measured = await measure(budget);
  const label = `${budget.width}×${budget.height}`.padEnd(12, " ");
  console.log(
    `${label}  ${String(measured.chatTitle ?? "-").padStart(10)}%  ${String(measured.insights ?? "-").padStart(13)}%  ${String(measured.cardText ?? "-").padStart(11)}%  ${measured.horizontalScroll > 2 ? "有" : "无"}`,
  );

  if (measured.chatTitle !== null) {
    check(`${label} 助手标题可用宽度 ≥${budget.chatTitle}%`, measured.chatTitle >= budget.chatTitle, `实测 ${measured.chatTitle}%`);
  }
  if (measured.insights !== null) {
    check(`${label} AI 建议正文宽度 ≥${budget.insightsText}%`, measured.insights >= budget.insightsText, `实测 ${measured.insights}%`);
  }
  if (measured.cardText !== null) {
    check(`${label} 物品卡片正文可用宽度 ≥${budget.cardText}%`, measured.cardText >= budget.cardText, `实测 ${measured.cardText}%`);
  }
  check(`${label} 无横向滚动`, measured.horizontalScroll <= 2, `溢出 ${measured.horizontalScroll}px`);
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
}
process.exit(failed.length ? 1 : 0);
