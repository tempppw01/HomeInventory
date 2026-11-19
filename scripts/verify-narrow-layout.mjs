// 窄屏(320px)布局的验收检查。
//
// 单独成篇的原因:套件默认按桌面尺寸跑,窄屏问题(标题被挤成两行、输入框 placeholder 折四行、
// 可点元素小于 44px)完全抓不到 —— 直到用户截图反馈才发现。
// 这里固化几条最容易退化的断言。

import { launchChromiumOrNull } from "./lib/browser.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const NARROW = { width: 320, height: 568 };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromiumOrNull();
if (!browser) {
  console.log("跳过:当前环境没有可用的 Chromium");
  process.exit(0);
}

const context = await browser.newContext({ viewport: NARROW });
const page = await context.newPage();

// 登录(窄屏同样是移动端布局)
await page.goto(BASE);
await page.waitForTimeout(1600);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
}
for (let i = 0; i < 5; i += 1) {
  const welcome = page.locator('[role="dialog"][aria-label="欢迎使用"]:visible');
  if ((await welcome.count()) === 0) break;
  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]:visible');
  if (await skip.count()) await skip.first().click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
}

// ============ 1. 各页面在 320px 下不横向滚动 ============
{
  const routes = ["/", "/items", "/locations", "/tasks", "/audit", "/settings"];
  const offenders = [];
  for (const route of routes) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2200);
    const state = await page.evaluate(() => ({
      docWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      boundary: (document.querySelector("main")?.innerText || "").includes("页面没能加载出来"),
    }));
    if (state.scrollWidth > state.docWidth + 2 || state.boundary) offenders.push(`${route}(scroll=${state.scrollWidth}/${state.docWidth},boundary=${state.boundary})`);
  }
  check("窄屏下各页面无横向滚动、无错误边界", offenders.length === 0, offenders.join(" | "));
}

// ============ 2. 助手面板:文字不折成多行 ============
{
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="打开归物助手"]').last().click();
  await page.waitForTimeout(1600);

  const panel = await page.evaluate(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => (node.getAttribute("aria-label") || "").includes("归物助手"));
    if (!dialog) return null;
    const lineCount = (node, fallback) => {
      if (!node) return 0;
      const rect = node.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight) || fallback;
      return Math.max(1, Math.round(rect.height / lineHeight));
    };
    const h2 = dialog.querySelector("h2");
    const subtitle = dialog.querySelector("p");
    const textarea = dialog.querySelector("textarea");
    return {
      titleLines: lineCount(h2, 22),
      subtitleLines: lineCount(subtitle, 16),
      textareaHeight: textarea ? Math.round(textarea.getBoundingClientRect().height) : 0,
      placeholder: textarea?.getAttribute("placeholder") ?? "",
      overflow: Array.from(dialog.querySelectorAll("*")).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 4 && (rect.right > window.innerWidth + 2 || rect.left < -2);
      }).length,
      smallTargets: Array.from(dialog.querySelectorAll("button")).filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.height < 40;
      }).length,
    };
  });

  if (!panel) {
    check("窄屏能打开助手面板", false, "panel not found");
  } else {
    check("助手标题在窄屏只占一行", panel.titleLines === 1, `lines=${panel.titleLines}`);
    check("助手副标题不折行", panel.subtitleLines === 1, `lines=${panel.subtitleLines}`);
    check("输入框保持单行高度", panel.textareaHeight <= 52, `height=${panel.textareaHeight}`);
    check("placeholder 足够短(不至于折行)", (panel.placeholder || "").length <= 8, `placeholder=${panel.placeholder}`);
    check("助手面板内没有元素溢出视口", panel.overflow === 0, `overflowing=${panel.overflow}`);
    check("助手面板内可点元素都 ≥40px", panel.smallTargets === 0, `small=${panel.smallTargets}`);
  }
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
}
process.exit(failed.length ? 1 : 0);
