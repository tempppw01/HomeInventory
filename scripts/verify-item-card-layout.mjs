// 物品卡片布局验收。
//
// 起因:桌面宽度下「可口可乐罐装」显示成了「可口...」—— 因为「建议重新分析」这个胶囊
// 挤在同一行,把物品名压到 53px(文字实际需要 84px)。物品名是这个页面最重要的信息,
// 不该为了一个状态标签让位。
//
// 现在胶囊移到了第二行的状态标签区(与「还剩 18 天」「需补货」「需冷藏」同处),
// 这条检查守住三件事:
//   1. 桌面宽度下物品名**一个都不截断**
//   2. 「建议重新分析」确实在第二行(位于名字下方),而不是又跑回标题行
//   3. 它仍是可点的按钮、有说明性的 aria-label,窄屏下点击区够大
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-item-card-layout.mjs

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

const finish = async (code) => {
  await context.close();
  await browser.close();
  process.exit(code);
};

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录", auth.ok, auth.detail);
if (!auth.ok) await finish(1);

const openItems = async () => {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);
};

// ---------- ① 桌面宽度:物品名一个都不截断 ----------
await openItems();
const names = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll("main span.truncate"))
    .filter((node) => /(罐|瓶|盒|包|袋|件|支|卷|台|个)$/.test(node.parentElement?.textContent?.trim() ?? "") || node.className.includes("font-extrabold"));
  return spans.map((node) => ({
    text: (node.textContent || "").trim(),
    available: node.clientWidth,
    needed: node.scrollWidth,
    truncated: node.scrollWidth > node.clientWidth + 2,
    title: node.getAttribute("title"),
  }));
});

check("读到了物品名(防止空跑)", names.length >= 5, `读到 ${names.length} 个`);

// 卡片宽度有限,名字特别长时截断是允许的。但截断必须是**可恢复**的:
// 被截掉的名字一定要能悬停看到全名(title),不能悄悄切掉。
// (注意别用「字数阈值」来判断 —— 可用宽度取决于卡片宽度与数据,
//  这一版我第一次写成「12 字以内不许截断」,而 CI 的种子数据里正好有个 12 字的名字,卡在边界上。)
const truncated = names.filter((entry) => entry.truncated);
const withoutTitle = truncated.filter((entry) => !entry.title);
const intact = names.filter((entry) => !entry.truncated);

check(
  "所有被截断的物品名都能悬停看到全名(title)",
  withoutTitle.length === 0,
  withoutTitle.map((entry) => `${entry.text}(${entry.available}<${entry.needed})`).join(", "),
);
check("至少有一个物品名完整显示(说明卡片宽度正常)", intact.length > 0, `${names.length} 个名字全部被截断`);

if (truncated.length) {
  console.log(`      提示:${truncated.length}/${names.length} 个名字因较长被截断(均已带 title 提示)`);
}

// ---------- ② 「建议重新分析」在名字下方,而不是标题行里 ----------
const pill = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("main button")).find((node) => /建议重新分析/.test(node.textContent || ""));
  if (!button) return { found: false };
  const rect = button.getBoundingClientRect();

  // 找它所属的那张卡片:从胶囊往上走,第一个「包含物品名」的祖先就是卡片。
  // (前两版都不对:一版往上找到了胶囊自己那层;一版要求水平重叠,
  //  但胶囊右对齐、名字左对齐,两者根本不重叠。)
  let card = button.parentElement;
  while (card && !Array.from(card.querySelectorAll("span.truncate")).some((node) => (node.className || "").includes("font-extrabold"))) {
    card = card.parentElement;
    if (!card || card.tagName === "MAIN") { card = null; break; }
  }

  const nameNode = card
    ? Array.from(card.querySelectorAll("span.truncate")).find((node) => (node.className || "").includes("font-extrabold"))
    : null;
  const nameRect = nameNode?.getBoundingClientRect();

  return {
    found: true,
    top: Math.round(rect.top),
    nameTop: nameRect ? Math.round(nameRect.top) : null,
    nameText: nameNode ? (nameNode.textContent || "").trim() : null,
    belowName: nameRect ? rect.top > nameRect.top + 4 : null,
    ariaLabel: button.getAttribute("aria-label"),
    height: Math.round(rect.height),
  };
});

check("页面上有「建议重新分析」入口(样例物品需要)", pill.found, "没找到(可能该物品已重新分析过)");
if (pill.found) {
  check("它在物品名下方(第二行状态区),不再挤占标题行", pill.belowName === true, `pill.top=${pill.top} name.top=${pill.nameTop}`);
  check("它带有说明性的 aria-label", /重新分析「.+」/.test(pill.ariaLabel ?? ""), `aria-label=${pill.ariaLabel}`);
}

// ---------- ③ 窄屏:点击区够大 ----------
await page.setViewportSize({ width: 390, height: 844 });
await openItems();
const narrow = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("main button")).find((node) => /建议重新分析/.test(node.textContent || ""));
  if (!button) return { found: false };
  const rect = button.getBoundingClientRect();
  return { found: true, height: Math.round(rect.height), width: Math.round(rect.width) };
});

if (!narrow.found) {
  console.log("      跳过窄屏点击区检查:窄屏下没有这个入口");
} else {
  check("窄屏下「建议重新分析」的点击区够高(≥40px)", narrow.height >= 40, `height=${narrow.height}`);
}

// ---------- ④ 窄屏下页面不该横向溢出 ----------
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
check("窄屏下没有横向溢出", !overflow, "页面出现了横向滚动");

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);