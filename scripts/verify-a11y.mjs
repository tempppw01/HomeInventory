// 键盘可访问性检查:焦点可见、弹窗焦点不逃逸、图片有替代文本、表单控件有名称。
//
// 为什么补这块:此前所有断言都在验「鼠标/触摸下能不能用」,
// 键盘与读屏用户看到的却是另一个界面 —— 焦点不可见会让人彻底迷路,
// 弹窗不困住焦点会一路 Tab 到背后的页面。
//
// 每条检查都带「确实测到了东西」的守卫:空页面上「没有不合格的图片」没有意义。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-a11y.mjs

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// 1×1 红色 PNG:用于让「图片预览」这类纯客户端渲染的 <img> 真的出现
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const pngPath = join(tmpdir(), "a11y-probe.png");
writeFileSync(pngPath, TINY_PNG);

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

await page.goto(`${BASE}/items`);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);

// ============ 0. 守卫:页面上得有可测的东西 ============
{
  const counts = await page.evaluate(() => ({
    inputs: document.querySelectorAll("input, textarea, select").length,
    focusable: document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
  }));
  check("页面上有足够的可聚焦元素(防止空跑)", counts.focusable >= 20, `focusable=${counts.focusable}`);
  check("页面上有表单控件(防止空跑)", counts.inputs >= 3, `inputs=${counts.inputs}`);
}

// ============ 1. 表单控件都有可访问名称 ============
{
  const unlabeled = await page.evaluate(() => {
    const labelFor = new Set(Array.from(document.querySelectorAll("label[for]")).map((label) => label.getAttribute("for")));
    return Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((node) => {
        const type = (node.getAttribute("type") || "").toLowerCase();
        if (["hidden", "submit", "button", "file"].includes(type)) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        const id = node.getAttribute("id");
        return !(node.getAttribute("aria-label") || node.getAttribute("aria-labelledby") || (id && labelFor.has(id)) || node.getAttribute("placeholder"));
      })
      .map((node) => `${node.tagName.toLowerCase()}[${node.getAttribute("type") || ""}]`);
  });
  check("表单控件都有可访问名称", unlabeled.length === 0, unlabeled.slice(0, 3).join(" | "));
}

// ============ 2. Tab 键移动时焦点可见 ============
{
  const invisible = [];
  let moved = 0;
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(110);
    const info = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node || node === document.body) return null;
      const style = getComputedStyle(node);
      const outlineVisible = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadowVisible = Boolean(style.boxShadow && style.boxShadow !== "none");
      return {
        label: (node.getAttribute("aria-label") || node.textContent || node.tagName).trim().slice(0, 18),
        visible: outlineVisible || shadowVisible,
      };
    });
    if (!info) continue;
    moved += 1;
    if (!info.visible) invisible.push(info.label);
  }
  check("Tab 键确实在移动焦点(防止空跑)", moved >= 5, `移动次数=${moved}`);
  check("用 Tab 键移动焦点时焦点可见", invisible.length === 0, invisible.slice(0, 4).join(" | "));
}

// ============ 2.5 图标按钮必须有可访问名 ============
// 纯图标按钮(看不见文字)如果连 aria-label 都没有,读屏只会念「按钮」。
{
  const nameless = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return false;
        const hasText = (button.textContent || "").trim().length > 0;
        const hasName = Boolean(button.getAttribute("aria-label") || button.getAttribute("aria-labelledby") || button.getAttribute("title"));
        return !hasText && !hasName;
      })
      .map((button) => String(button.className).slice(0, 30));
  });
  check("图标按钮都有可访问名", nameless.length === 0, nameless.slice(0, 4).join(" | "));
}

// ============ 3. 图片预览有替代文本(批量识别弹窗,纯客户端渲染)============
{
  // 用 Playwright 的可操作性等待,而不是「DOM 里 click + 固定等待」:
  // 后者在较慢的机器上可能点击早于 React 挂载,事件没接上,弹窗自然打不开(CI 上就这么红过一次)。
  const trigger = page.locator('button[aria-label="AI 批量识别物品"]').first();
  let dialogOpen = false;
  let triggerDetail = "";
  try {
    await trigger.waitFor({ state: "visible", timeout: 20000 });
    for (let attempt = 0; attempt < 2 && !dialogOpen; attempt += 1) {
      await trigger.click({ timeout: 10000 });
      await page.waitForTimeout(900);
      dialogOpen = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
    }
  } catch (error) {
    triggerDetail =
      `按钮数=${await page.locator('button[aria-label="AI 批量识别物品"]').count()}` +
      ` 弹窗数=${await page.locator('[role="dialog"]').count()}` +
      ` 原因=${error instanceof Error ? error.message.split("\n")[0].slice(0, 80) : error}`;
  }
  check("能打开「AI 批量识别」弹窗", dialogOpen, triggerDetail || "点击后弹窗未出现");

  if (dialogOpen) {
    const fileInput = page.locator('[role="dialog"] input[type="file"]').first();
    const hasFileInput = (await fileInput.count()) > 0;
    check("批量识别弹窗里有文件选择框", hasFileInput);

    let images = 0;
    let missingAlt = [];
    if (hasFileInput) {
      await fileInput.setInputFiles(pngPath);
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('[role="dialog"] img'));
        return {
          total: nodes.length,
          missing: nodes
            .filter((img) => {
              const alt = img.getAttribute("alt");
              return alt === null || alt.trim() === "";
            })
            .map((img) => (img.getAttribute("src") || "").slice(0, 24)),
          removeButtons: Array.from(document.querySelectorAll('[role="dialog"] button'))
            .filter((button) => (button.getAttribute("aria-label") || "").includes("移除"))
            .map((button) => button.getAttribute("aria-label")),
        };
      });
      images = state.total;
      missingAlt = state.missing;
      check("图片预览确实渲染出来了(防止空跑)", images > 0, `img=${images}`);
      check("图片预览都有替代文本(alt)", missingAlt.length === 0, missingAlt.slice(0, 3).join(" | "));
      check("预览上的移除按钮有可访问名", state.removeButtons.length > 0, `命中=${state.removeButtons.length}`);
    }

    // ============ 4. 弹窗内 Tab 焦点不逃逸 ============
    let escaped = null;
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(60);
      const outside = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;
        if (active.closest('[role="dialog"]')) return null;
        return (active.getAttribute("aria-label") || active.textContent || active.tagName).trim().slice(0, 20);
      });
      if (outside) { escaped = outside; break; }
    }
    check("弹窗内按 Tab 焦点不会跑到背后页面", escaped === null, `逃逸到:${escaped}`);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    const closed = await page.evaluate(() => !Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
    check("Esc 可以关闭弹窗", closed);
  }
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);