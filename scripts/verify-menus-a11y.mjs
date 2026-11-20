// 菜单类无障碍检查:右键菜单、快捷菜单要符合菜单语义与键盘习惯。
//
// 为什么单独成一组:菜单不是对话框 —— 键盘用户的预期是「打开即落到第一项、方向键上下移动、
// Esc 关闭」,而不是「Tab 一个个走」。如果哪天被重构成一排普通按钮,这些都会悄悄失效。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-menus-a11y.mjs

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

const SURFACES = [
  { label: "物品行右键菜单", open: async () => page.locator('main button[aria-label="更多操作"]').first().click({ button: "right" }) },
  { label: "「更多操作」快捷菜单", open: async () => page.locator('main button[aria-label="更多操作"]').first().click() },
];

let scanned = 0;

for (const surface of SURFACES) {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);

  const trigger = page.locator('main button[aria-label="更多操作"]').first();
  if ((await trigger.count()) === 0) {
    console.log(`SKIP  ${surface.label}:页面上没有物品行操作按钮`);
    continue;
  }

  try {
    await surface.open();
  } catch (error) {
    check(`${surface.label}:能打开`, false, error instanceof Error ? error.message.split("\n")[0].slice(0, 80) : String(error));
    continue;
  }
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => {
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).find((node) => node.getBoundingClientRect().height > 0) ?? null;
    if (!menu) return null;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const fallbackItems = Array.from(menu.querySelectorAll("button, a"));
    const nameless = fallbackItems.filter((node) => {
      const hasText = (node.textContent || "").trim().length > 0;
      const hasName = Boolean(node.getAttribute("aria-label") || node.getAttribute("title"));
      return !hasText && !hasName;
    }).length;
    return {
      label: menu.getAttribute("aria-label") || menu.getAttribute("aria-labelledby") || null,
      menuitemCount: items.length,
      fallbackCount: fallbackItems.length,
      nameless,
      activeIsMenuitem: document.activeElement?.getAttribute?.("role") === "menuitem",
    };
  });

  if (!state) {
    check(`${surface.label}:打开后是菜单语义(role=menu)`, false, "没有找到 role=menu 的弹层");
    await page.keyboard.press("Escape");
    continue;
  }

  scanned += 1;
  check(`${surface.label}:是菜单语义(role=menu)`, true);
  check(`${surface.label}:菜单项使用 role=menuitem`, state.menuitemCount > 0 && state.menuitemCount === state.fallbackCount, `menuitem=${state.menuitemCount} 可点项=${state.fallbackCount}`);
  check(`${surface.label}:菜单项都有可访问名`, state.nameless === 0, `无名字=${state.nameless}`);
  check(`${surface.label}:打开后焦点落在菜单项上`, state.activeIsMenuitem, "焦点不在 menuitem 上");

  // 方向键在菜单内移动
  const beforeArrow = await page.evaluate(() => (document.activeElement?.textContent || "").trim().slice(0, 12));
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  const afterArrow = await page.evaluate(() => ({
    isMenuitem: document.activeElement?.getAttribute?.("role") === "menuitem",
    text: (document.activeElement?.textContent || "").trim().slice(0, 12),
  }));
  check(`${surface.label}:方向键在菜单内移动焦点`, afterArrow.isMenuitem && afterArrow.text !== beforeArrow, `前=${beforeArrow} 后=${afterArrow.text}`);

  // Esc 关闭
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const closed = await page.evaluate(() => !Array.from(document.querySelectorAll('[role="menu"]')).some((node) => node.getBoundingClientRect().height > 0));
  check(`${surface.label}:Esc 能关闭菜单`, closed);
}

await context.close();
await browser.close();

console.log(`\n扫描了 ${scanned} 个菜单`);
const failed = results.filter((entry) => !entry.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
if (scanned === 0) {
  console.log("没有扫描到任何菜单 —— 视为失败(避免空跑)");
  process.exit(1);
}
process.exit(failed.length ? 1 : 0);