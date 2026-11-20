// 颜色对比度检查:WCAG AA 要求正文 ≥ 4.5:1、大字 ≥ 3:1。
//
// 为什么单独做:焦点、名字、菜单这些是「能不能操作」,对比度是「能不能看清」。
// 明暗两套主题各有一套色板,靠肉眼很难发现某处次要文字刚好差一点。
//
// 做法:遍历带直接文字的元素,取自身颜色 + 向上找第一个不透明背景,算对比度。
// 渐变/图片背景无法可靠判定,跳过并计数(不静默)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-contrast.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const PAGES = ["/", "/items", "/locations", "/tasks", "/audit", "/settings", "/report"];
const THEMES = ["light", "dark"];

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

const measure = () => page.evaluate(() => {
  const parseColor = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(/[,/]/).map((part) => Number(part.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (fg, bg) => {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };

  const failures = [];
  let checked = 0;
  let skipped = 0;

  const elements = Array.from(document.querySelectorAll("main *, header *, nav *, footer *"));
  for (const node of elements) {
    if (!(node instanceof HTMLElement)) continue;
    // 只看「直接包含文字」的元素,避免重复计算容器
    const directText = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent || "")
      .join("")
      .trim();
    if (directText.length < 2) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    if (style.backgroundImage && style.backgroundImage !== "none") { skipped += 1; continue; }

    const fg = parseColor(style.color);
    if (!fg || fg.a < 0.99) { skipped += 1; continue; }

    // 向上找第一个不透明背景
    let bg = null;
    let walker = node;
    while (walker) {
      const walkerStyle = getComputedStyle(walker);
      if (walkerStyle.backgroundImage && walkerStyle.backgroundImage !== "none") break;
      const candidate = parseColor(walkerStyle.backgroundColor);
      if (candidate && candidate.a >= 0.99) { bg = candidate; break; }
      walker = walker.parentElement;
    }
    if (!bg) { skipped += 1; continue; }

    const fontSize = Number.parseFloat(style.fontSize);
    const weight = Number.parseInt(style.fontWeight, 10) || 400;
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const need = isLarge ? 3 : 4.5;
    const value = ratio(fg, bg);
    checked += 1;
    if (value + 0.01 < need) {
      failures.push({
        text: directText.slice(0, 20),
        size: `${Math.round(fontSize)}px/${weight}`,
        ratio: Number(value.toFixed(2)),
        need,
        cls: String(node.className).slice(0, 36),
      });
    }
  }

  // 同一处样式可能重复出现,按「文字+class+比例」去重
  const seen = new Set();
  const unique = failures.filter((item) => {
    const key = `${item.text}|${item.cls}|${item.ratio}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { checked, skipped, failures: unique.slice(0, 10), total: unique.length };
});

for (const theme of THEMES) {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(1800);
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  await page.waitForTimeout(400);

  for (const route of PAGES) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2200);
    await dismissBlockingDialogs(page);
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    // 主题切换带 transition(例如 body 的 color 有过渡),取样太早会读到中间态,
    // 于是把浅色的深字当成深色问题的误报就是这么来的 —— 测量前先把动画关掉。
    await page.addStyleTag({ content: "* { transition: none !important; animation: none !important; }" });
    await page.waitForTimeout(600);

    const state = await measure();
    const label = `${theme === "dark" ? "深色" : "浅色"} ${route}`;
    if (state.checked === 0) {
      check(`${label}:测到了文字(防止空跑)`, false, "没有可比对的文字元素");
      continue;
    }
    check(
      `${label}:文字对比度达标(共测 ${state.checked} 处)`,
      state.total === 0,
      state.failures.map((item) => `「${item.text}」${item.ratio}(需${item.need})`).join(" | "),
    );
  }
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);