// 日期选择器回归。
//
// 为什么补这一条:`docs/verification.md` 的「已知未覆盖」里挂着它 ——
// 「打印工作室 / 日期选择器的自动扫描:两者都是嵌套弹窗,自动判定不稳定;已单独探测确认过行为,
// 但**没有纳入回归**」。它是一个手写的 role="grid" 日历(roving tabindex、周界、换月、范围夹取),
// 正是那种「改一行就会坏、而且不会有人立刻发现」的组件。
//
// 这里不去扫弹窗(那条路确实不稳定),而是把行为逐条钉住:打开、网格语义、方向键、换月、
// 范围边界、回车选中、Esc 关闭与焦点归还。全都不依赖 AI,可以直接进 CI。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-date-picker.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

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

await page.goto(BASE);
await page.waitForTimeout(1800);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
}
await dismissBlockingDialogs(page);

/** 面板状态:网格的月份标题、焦点单元格与它的日期。 */
const panelState = () => page.evaluate(() => {
  const grid = document.querySelector('[role="grid"]');
  const active = document.activeElement;
  const label = active?.getAttribute?.("aria-label") ?? "";
  const parsed = /(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日/.exec(label);
  const cells = grid ? [...grid.querySelectorAll('[role="gridcell"]')] : [];
  return {
    gridLabel: grid?.getAttribute("aria-label") ?? null,
    cellLabel: label || null,
    date: parsed ? `${parsed[1]}-${String(parsed[2]).padStart(2, "0")}-${String(parsed[3]).padStart(2, "0")}` : null,
    tabbable: cells.filter((cell) => cell.tabIndex === 0).length,
    cells: cells.length,
    activeTag: active?.tagName ?? null,
    activeIsCell: Boolean(active?.getAttribute?.("role") === "gridcell"),
  };
});

const focusTrigger = (part) => page.evaluate((labelPart) => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return false;
  const target = [...dialog.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") || "").includes(labelPart));
  if (!target) return false;
  target.focus();
  return true;
}, part);

try {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2200);
  await dismissBlockingDialogs(page);

  await page.locator('button[aria-label="录入物品"]').first().click();
  await page.waitForTimeout(1500);
  const more = page.locator('[role="dialog"] button:has-text("更多信息")').first();
  check("录入物品弹窗里有「更多信息」折叠行", (await more.count()) > 0);
  if (await more.count()) { await more.click(); await page.waitForTimeout(800); }

  // ---------- 1 用键盘打开 ----------
  const focusedTrigger = await focusTrigger("购入日期");
  check("能找到「购入日期」字段并聚焦它", focusedTrigger);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const opened = await panelState();
  check("回车能打开日历(有 role=grid 的网格)", Boolean(opened.gridLabel), JSON.stringify(opened));
  check("网格有可访问名(年月)", /年 \d{1,2} 月日历/.test(opened.gridLabel || ""), opened.gridLabel ?? "无");
  check("打开后焦点落在某一天上", opened.activeIsCell && Boolean(opened.date), JSON.stringify({ tag: opened.activeTag, cell: opened.cellLabel }));
  check("网格里只有一个可 Tab 到的单元格(roving tabindex)", opened.tabbable === 1, `tabbable=${opened.tabbable} cells=${opened.cells}`);
  check("单元格的可访问名含年月日与周几", /\d{4} 年 \d{1,2} 月 \d{1,2} 日 周/.test(opened.cellLabel || ""), opened.cellLabel ?? "无");

  // ---------- 2 方向键与周界 ----------
  const move = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(220);
    return panelState();
  };
  const start = opened.date;
  const left = await move("ArrowLeft");
  check("← 退一天", left.date !== null && left.date < start, `${start} → ${left.date}`);
  const up = await move("ArrowUp");
  check("↑ 退一周", up.date !== null && up.date < left.date, `${left.date} → ${up.date}`);
  const home = await move("Home");
  const homeDay = home.date ? new Date(`${home.date}T00:00:00`).getDay() : null;
  check("Home 跳到本周第一天(周一)", homeDay === 1, `${home.date} 是周${homeDay}`);
  const end = await move("End");
  const endDay = end.date ? new Date(`${end.date}T00:00:00`).getDay() : null;
  check("End 跳到本周最后一天(周日)", endDay === 0, `${end.date} 是周${endDay}`);

  // ---------- 3 不能选到未来(购入日期的上限是今天) ----------
  const today = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const clamped = await panelState();
  check("→ 到「今天」就停住,不会跑到未来", clamped.date !== null && clamped.date <= today, `焦点=${clamped.date} 今天=${today}`);

  // ---------- 4 换月 ----------
  const beforeMonth = (await panelState()).gridLabel;
  const previous = await move("PageUp");
  check("PageUp 切到上个月,网格标题跟着变", previous.gridLabel !== beforeMonth, `${beforeMonth} → ${previous.gridLabel}`);
  const next = await move("PageDown");
  check("PageDown 切回来", next.gridLabel === beforeMonth, `${previous.gridLabel} → ${next.gridLabel}`);

  // ---------- 5 回车选中 ----------
  // 选一个「离今天足够远」的日子:太近的话按钮上显示的是相对说法(今天 / 昨天),
  // 那样就分不清「真的写进去了」还是「只是碰巧写着昨天」。
  for (let index = 0; index < 40; index += 1) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  const picked = await panelState();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const afterPick = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const trigger = [...dialog.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") || "").includes("购入日期"));
    return {
      gridOpen: Boolean(document.querySelector('[role="grid"]')),
      triggerText: (trigger?.textContent || "").trim(),
      activeIsTrigger: document.activeElement === trigger,
    };
  });
  check("回车选中后日历关闭", !afterPick.gridOpen);
  const expectedText = `${Number(picked.date.slice(5, 7))} 月 ${Number(picked.date.slice(8, 10))} 日`;
  check("触发按钮上显示出所选日期", afterPick.triggerText.includes(expectedText), `选了 ${picked.date},期望含「${expectedText}」,按钮显示「${afterPick.triggerText}」`);
  check("选中后焦点回到触发按钮", afterPick.activeIsTrigger);

  // ---------- 6 Esc 关闭且不改值 ----------
  await focusTrigger("购入日期");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const afterEscape = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const trigger = [...dialog.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") || "").includes("购入日期"));
    return {
      gridOpen: Boolean(document.querySelector('[role="grid"]')),
      triggerText: (trigger?.textContent || "").trim(),
      focusIsTrigger: document.activeElement === trigger,
      focusIsBody: !document.activeElement || document.activeElement === document.body,
    };
  });
  check("Esc 能关掉日历", !afterEscape.gridOpen);
  check("Esc 不改动已选日期", afterEscape.triggerText === afterPick.triggerText, `「${afterPick.triggerText}」→「${afterEscape.triggerText}」`);
  check("Esc 关闭后焦点回到触发按钮(没有掉到 body)", afterEscape.focusIsTrigger && !afterEscape.focusIsBody, JSON.stringify(afterEscape));
} finally {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  await context.close();
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);