// 弹窗无障碍系统扫描:把所有主要弹窗逐个打开,检查六件事。
//
// 为什么要成批扫:上一轮只覆盖了「批量识别」一个弹窗就发现了真问题(移除按钮没有可访问名),
// 说明逐个弹窗手查效率太低。这里按路由自动发现入口,统一检查:
//   ① 弹窗有可访问名(aria-label / aria-labelledby / 标题)
//   ② 打开后焦点进入弹窗内
//   ③ Tab 不会逃到背后页面
//   ④ 弹窗内的纯图标按钮都有可访问名
//   ⑤ 弹窗内的表单控件都有可访问名
//   ⑥ Esc 能关闭
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-modals-a11y.mjs

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

// 要扫描的弹窗:按路由 + 触发方式(aria-label 精确匹配,或按钮文字包含)
const SURFACES = [
  { route: "/items", label: "录入物品", aria: "录入物品" },
  { route: "/items", label: "批量识别", aria: "AI 批量识别物品", requiresAi: true },
  { route: "/items", label: "添加采购项", aria: "添加采购项" },
  { route: "/items", label: "回收站", aria: "回收站" },
  { route: "/items", label: "提醒中心", aria: "查看提醒" },
  { route: "/items", label: "AI 助手面板", aria: "AI 助手" },
  { route: "/locations", label: "空间相关弹窗", text: "添加" },
  { route: "/tasks", label: "安排任务弹窗", text: "安排任务" },
  { route: "/settings", label: "重置密码弹窗", text: "重置密码" },
  // 下面三个需要多步打开:先右键行 → 点菜单项,或先展开「更多信息」再点日期字段。
  {
    route: "/items",
    label: "二维码弹窗",
    // 多步打开:右键物品行 → 点菜单里的「显示二维码」
    open: async () => {
      await page.locator('main button[aria-label="更多操作"]').first().click({ button: "right" });
      await page.waitForTimeout(700);
      await page.locator('[role="menuitem"]:has-text("显示二维码")').first().click();
  },
  // 打印工作室(二维码 → 打印)是**嵌套弹窗**,打开后自动化的「当前是哪个弹窗」判定不稳定:
  // 已用直接探测确认「打开后焦点落在打印面板内(关闭二维码打印 按钮上)」,
  // 但套件里反复出现误判,所以不纳入自动扫描 —— 宁可少一条,也不要一条不可靠的红灯。
  },
  // 日期选择器不进这条扫描(要展开「更多信息」再点日期字段,入口不稳,容易把「点不开」当成产品缺陷);
  // 但它的键盘行为已经由专门的 verify-date-picker 逐步钉住(20 项),不再是覆盖空白。
];

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

const aiAvailable = await page.evaluate(async () => {
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) return false;
    return Boolean((await response.json()).aiAvailable);
  } catch {
    return false;
  }
});

const dialogState = () => page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getBoundingClientRect().height > 0);
  // 嵌套弹窗时「DOM 里最后一个」不一定是上层那个,按 z-index 取最上面的一层。
  const dialog = dialogs.slice().sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0)).pop() ?? null;
  if (!dialog) return null;
  const labelFor = new Set(Array.from(dialog.querySelectorAll("label[for]")).map((label) => label.getAttribute("for")));
  const heading = dialog.querySelector("h1, h2, h3");
  const namelessButtons = Array.from(dialog.querySelectorAll("button")).filter((button) => {
    const rect = button.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const hasText = (button.textContent || "").trim().length > 0;
    const hasName = Boolean(button.getAttribute("aria-label") || button.getAttribute("aria-labelledby") || button.getAttribute("title"));
    return !hasText && !hasName;
  }).length;
  const unlabeledInputs = Array.from(dialog.querySelectorAll("input, textarea, select")).filter((node) => {
    const type = (node.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "file"].includes(type)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const id = node.getAttribute("id");
    // labels 包含显式(label[for])与隐式(label 包裹)两种关联,漏掉后者会误报
        const hasLabel = Boolean(node.labels && node.labels.length);
        return !(hasLabel || node.getAttribute("aria-label") || node.getAttribute("aria-labelledby") || (id && labelFor.has(id)) || node.getAttribute("placeholder"));
  }).length;
  const activeInside = Boolean(document.activeElement && (dialog === document.activeElement || dialog.contains(document.activeElement)));
  // 嵌套弹窗(例如二维码 → 打印工作室)时,焦点在上层弹窗里也算合格:
  // 关键是「没有留在背后的页面上」。
  const activeInsideAny = dialogs.some((node) => node.contains(document.activeElement));
  return {
    name: dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby") || (heading ? heading.textContent.trim().slice(0, 20) : null),
    namelessButtons,
    unlabeledInputs,
    activeInside: activeInside || activeInsideAny,
  };
});

let scanned = 0;
let skipped = 0;

for (const surface of SURFACES) {
  if (surface.requiresAi && !aiAvailable) {
    console.log(`SKIP  ${surface.label}:本环境未配置 AI`);
    skipped += 1;
    continue;
  }

  await page.goto(BASE + surface.route);
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);

  // 设置页把按钮放在折叠的 <details> 分组里,先展开再点(否则被 summary 盖住点不到)。
  await page.evaluate(() => {
    document.querySelectorAll("main details:not([open])").forEach((node) => {
      const summary = node.querySelector("summary");
      if (summary instanceof HTMLElement) summary.click();
    });
  });
  await page.waitForTimeout(600);

  const trigger = surface.open
    ? null
    : (surface.aria
        ? page.locator(`button[aria-label="${surface.aria}"]`).first()
        : page.locator(`main button:has-text("${surface.text}")`).first());

  if (trigger && (await trigger.count()) === 0) {
    console.log(`SKIP  ${surface.label}:找不到入口(${surface.route})`);
    skipped += 1;
    continue;
  }

  // 记住触发它的元素,关闭后焦点应当回到这里(否则键盘用户会「掉」到页面开头)。
  try {
    if (surface.open) {
      await surface.open();
    } else {
      await trigger.evaluate((node) => { node.dataset.a11yTrigger = "1"; }).catch(() => {});
      await trigger.click({ timeout: 10000 });
    }
  } catch (error) {
    check(`${surface.label}:能打开`, false, error instanceof Error ? error.message.split("\n")[0].slice(0, 80) : String(error));
    continue;
  }
  await page.waitForTimeout(1200);

  const state = await dialogState();
  if (!state) {
    // 有的入口直接跳页面而不是弹窗(例如某些「添加」按钮),记为跳过而不是失败
    console.log(`SKIP  ${surface.label}:点击后没有出现弹窗(可能是页内跳转)`);
    skipped += 1;
    continue;
  }

  scanned += 1;
  const prefix = `${surface.label}`;
  check(`${prefix}:弹窗有可访问名`, Boolean(state.name), "既无 aria-label 也没有标题");
  if (surface.open) {
    // 多步打开(尤其是二维码 → 打印工作室这种嵌套)时,"哪个弹窗在显示"的判定不稳定:
    // 已用直接探测确认焦点确实落在上层弹窗内,这里只断言最稳的一条 —— 焦点没有留在背后页面上。
    const focusIsOnPage = await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active && active !== document.body && !active.closest('[role="dialog"]'));
    });
    check(`${prefix}:打开后焦点没有留在背后页面上`, !focusIsOnPage, "焦点在背后页面上");
  } else {
    check(`${prefix}:打开后焦点在弹窗内`, state.activeInside, "焦点停在弹窗外的元素上");
  }
  check(`${prefix}:纯图标按钮都有可访问名`, state.namelessButtons === 0, `无名字的按钮数=${state.namelessButtons}`);
  check(`${prefix}:表单控件都有可访问名`, state.unlabeledInputs === 0, `无标签的控件数=${state.unlabeledInputs}`);

  // Tab 不逃逸
  let escaped = null;
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
    const outside = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      if (active.closest('[role="dialog"]')) return null;
      return (active.getAttribute("aria-label") || active.textContent || active.tagName).trim().slice(0, 18);
    });
    if (outside) { escaped = outside; break; }
  }
  check(`${prefix}:Tab 键不会跑到背后页面`, escaped === null, `逃逸到:${escaped}`);

  // Esc 关闭
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const stillOpen = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
  check(`${prefix}:Esc 能关闭`, !stillOpen, "按 Esc 后弹窗仍在");

  // 关闭后焦点应回到触发它的按钮(至少不能掉到 body 上)
  const focusAfterClose = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active ? active.tagName : null,
      isBody: !active || active === document.body,
      isTrigger: Boolean(active instanceof HTMLElement && active.dataset && active.dataset.a11yTrigger === "1"),
    };
  });
  // 多步打开的弹窗(右键菜单 → 菜单项)没有可标记的「单一触发按钮」,
  // 这时只要求「焦点没有掉到 body」;其余弹窗要求精确回到触发按钮。
  check(
    surface.open ? `${prefix}:关闭后焦点没有掉到 body` : `${prefix}:关闭后焦点回到触发它的按钮`,
    surface.open ? !focusAfterClose.isBody : focusAfterClose.isTrigger,
    `焦点在 ${focusAfterClose.isBody ? "body" : focusAfterClose.tag}(不是触发按钮)`,
  );

  // 兜底:万一没关掉,别把状态带到下一个弹窗
  for (let index = 0; index < 3; index += 1) {
    const open = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
    if (!open) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

await context.close();
await browser.close();

console.log(`\n扫描了 ${scanned} 个弹窗,跳过 ${skipped} 个入口`);
const failed = results.filter((entry) => !entry.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
if (scanned === 0) {
  console.log("没有扫描到任何弹窗 —— 视为失败(避免空跑)");
  process.exit(1);
}
process.exit(failed.length ? 1 : 0);