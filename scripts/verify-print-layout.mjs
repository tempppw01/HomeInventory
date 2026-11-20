// 打印排版验收(补「实际打印输出」这块空白里能验的部分)。
//
// 此前只验到「打印面板的控件与可访问名」。这里再往前一步:用浏览器的
// print 媒体模拟,直接量**实际渲染出来的几何** —— 标签是不是按设定的毫米尺寸排版、
// 每行几列、纸张尺寸对不对、标签有没有溢出纸面。
//
// 说明:这仍然不是「纸上的结果」(那需要真实打印机),但它验证的是同一份打印样式表
// 在排版引擎里的真实产物:配置 → CSS(mm)→ 渲染(px)。换算按 CSS 的 96dpi:
// 1mm = 96/25.4 ≈ 3.7795px。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-print-layout.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const MM = 96 / 25.4;

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

// ---------- 打开打印工作室(物品 ⋯ → 显示二维码 → 打印) ----------
await page.goto(`${BASE}/items`);
await page.waitForTimeout(2800);
await dismissBlockingDialogs(page);
await page.locator('main button[aria-label="更多操作"]').first().click({ button: "right" });
await page.waitForTimeout(800);
await page.locator('[role="menuitem"]:has-text("显示二维码")').first().click();
await page.waitForTimeout(900);
await page.locator('[role="dialog"] button:has-text("打印")').first().click();
await page.waitForTimeout(1400);

const studio = page.locator('[role="dialog"][aria-label="二维码打印"]');
check("打印工作室打开了", (await studio.count()) > 0, "没找到二维码打印面板");

// ---------- 读注入的打印样式里的毫米值 ----------
const readCss = () => page.evaluate(() => {
  const styles = Array.from(document.querySelectorAll("style")).map((node) => node.textContent || "");
  const css = styles.find((text) => text.includes(".print-sheet")) ?? "";
  const sheet = /\.print-sheet[^}]*width:\s*([\d.]+)mm/.exec(css);
  const label = /\.print-label[^}]*width:\s*([\d.]+)mm[^}]*height:\s*([\d.]+)mm/.exec(css);
  const page = /@page\s*\{[^}]*size:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(css);
  return {
    hasSheet: Boolean(sheet),
    sheetWidthMm: sheet ? Number(sheet[1]) : null,
    labelWidthMm: label ? Number(label[1]) : null,
    labelHeightMm: label ? Number(label[2]) : null,
    pageWidthMm: page ? Number(page[1]) : null,
    pageHeightMm: page ? Number(page[2]) : null,
  };
});

const css = await readCss();
check("打印样式里声明了纸张尺寸(@page)", Boolean(css.pageWidthMm && css.pageHeightMm), JSON.stringify(css));
check("A4 纵向:纸张 210 × 297mm", css.pageWidthMm === 210 && css.pageHeightMm === 297, `${css.pageWidthMm}×${css.pageHeightMm}`);
check("打印样式里声明了标签与纸张的毫米尺寸", Boolean(css.labelWidthMm && css.labelHeightMm && css.sheetWidthMm), JSON.stringify(css));

// ---------- 切到 print 媒体后量渲染结果 ----------
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(600);

const measure = () => page.evaluate(() => {
  const sheet = document.querySelector(".print-sheet");
  const labels = Array.from(document.querySelectorAll(".print-label"));
  const placeholders = Array.from(document.querySelectorAll(".print-placeholder"));
  if (!sheet) return null;
  const sheetRect = sheet.getBoundingClientRect();
  const rows = new Map();
  for (const node of [...labels, ...placeholders]) {
    const top = Math.round(node.getBoundingClientRect().top);
    rows.set(top, (rows.get(top) ?? 0) + 1);
  }
  const firstLabel = labels[0]?.getBoundingClientRect();
  const maxRight = labels.reduce((max, node) => Math.max(max, node.getBoundingClientRect().right), 0);
  return {
    sheetWidthPx: sheetRect.width,
    labelCount: labels.length,
    placeholderCount: placeholders.length,
    firstRowCount: rows.size ? rows.get(Math.min(...rows.keys())) : 0,
    firstLabelWidthPx: firstLabel?.width ?? null,
    firstLabelHeightPx: firstLabel?.height ?? null,
    maxRightPx: maxRight,
    sheetLeftPx: sheetRect.left,
  };
});

const layout = await measure();
check("打印区域渲染出来了", Boolean(layout && layout.labelCount > 0), JSON.stringify(layout).slice(0, 160));

if (layout && css.labelWidthMm) {
  const expectW = css.labelWidthMm * MM;
  const expectH = css.labelHeightMm * MM;
  const near = (actual, expected) => actual !== null && Math.abs(actual - expected) <= 3;

  check("标签宽度按设定的毫米渲染", near(layout.firstLabelWidthPx, expectW), `实测 ${layout.firstLabelWidthPx?.toFixed(1)}px,期望 ${expectW.toFixed(1)}px(${css.labelWidthMm}mm)`);
  check("标签高度按设定的毫米渲染", near(layout.firstLabelHeightPx, expectH), `实测 ${layout.firstLabelHeightPx?.toFixed(1)}px,期望 ${expectH.toFixed(1)}px(${css.labelHeightMm}mm)`);
  check("打印区域宽度等于纸张宽度", near(layout.sheetWidthPx, (css.pageWidthMm ?? 210) * MM), `实测 ${layout.sheetWidthPx.toFixed(1)}px`);

  // 关键用户承诺:标签不会溢出纸面
  const overflow = layout.maxRightPx - (layout.sheetLeftPx + layout.sheetWidthPx);
  check("标签没有超出纸张右边界", overflow <= 2, `超出 ${overflow.toFixed(1)}px`);
}

// ---------- 控件真的接到排版上:批量打印 4 张,改「每行标签数」看换行 ----------
//
// 用 4 张标签来验:二维码流程只带 1 件物品,首行永远只有 1 个标签,
// 那样的断言测不出「每行几列」(第一次就是这么写错的)。
{
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);

  // 进入选择模式。勾选不是原生 checkbox,而是卡片左上角的图标按钮,
  // 它的可访问名是「选择物品」(这一条我一开始也看错了 —— 长行被截断,以为它没有名字)。
  const modeToggle = page.locator('main button:text-is("选择")').first();
  if ((await modeToggle.count()) > 0) {
    await modeToggle.click();
    await page.waitForTimeout(800);
  }
  const selectButtons = page.locator('main button[aria-label="选择物品"]');
  const total = await selectButtons.count();
  const wanted = Math.min(4, total);
  for (let index = 0; index < wanted; index += 1) await selectButtons.nth(index).click();
  await page.waitForTimeout(600);

  const printButton = page.locator('main button:has-text("打印二维码"), main button:has-text("打印")').first();
  check(`能勾选并批量打印(勾了 ${wanted} 件)`, wanted >= 4 && (await printButton.count()) > 0, `勾选数=${wanted}`);

  if (wanted >= 4 && (await printButton.count()) > 0) {
    await printButton.click();
    await page.waitForTimeout(1500);
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(600);

    const before = await measure();
    check("批量打印渲染出 4 张标签", before?.labelCount === 4, `实测 ${before?.labelCount} 张`);

    // 改成每行 2 列 → 4 张应当排成两行
    await page.emulateMedia({ media: "screen" });
    await page.waitForTimeout(400);
    const columnSelect = page.locator('select[aria-label="每行标签数"]').first();
    const options = await columnSelect.evaluate((node) => Array.from(node.options).map((option) => option.value));
    if (options.includes("2")) await columnSelect.selectOption("2");
    await page.waitForTimeout(900);

    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(".print-label"));
      const grouped = new Map();
      for (const node of nodes) {
        const top = Math.round(node.getBoundingClientRect().top);
        grouped.set(top, (grouped.get(top) ?? 0) + 1);
      }
      return Array.from(grouped.values());
    });

    check("每行 2 列时,4 张标签排成 2 行、每行 2 张", rows.length === 2 && rows.every((count) => count === 2), `实际每行张数=${rows.join(",")}`);
  }
}

await page.emulateMedia({ media: "screen" });
await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);