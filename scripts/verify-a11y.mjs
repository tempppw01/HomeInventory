// 键盘可访问性检查:焦点可见、弹窗焦点不逃逸、图标按钮有名字、图片有替代文本。
//
// 为什么补这块:此前所有断言都在验「鼠标/触摸下能不能用」,
// 键盘与读屏用户看到的却是另一个界面 —— 焦点不可见会让人彻底迷路,
// 弹窗不困住焦点会一路 Tab 到背后的页面,纯图标按钮没有名字只会被念成「按钮」。
//
// 每条检查都带「确实测到了东西」的守卫:空页面上「没有不合格的图片」没有意义。
//
// 环境差异:未配置 AI 时,「批量识别」入口会提示并跳去设置页(设计如此),
// 弹窗根本不会出现 —— 所以图片相关的检查按 aiAvailable 跳过,而不是判失败。
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

// 1×1 红色 PNG:让「图片预览」这类纯客户端渲染的 <img> 真的出现
const pngPath = join(tmpdir(), "a11y-probe.png");
writeFileSync(
  pngPath,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

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

// 未配置 AI 时「批量识别」会跳去设置页,先探测一下,后面的图片检查据此决定是否执行
const aiAvailable = await page.evaluate(async () => {
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body.aiAvailable);
  } catch {
    return false;
  }
});

await page.goto(`${BASE}/items`);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);

/**
 * 文件输入框的键盘可达性。
 *
 * 为什么单独量:页面上四处「上传图片」把 <input type="file"> 写成 className="hidden"
 * (display:none),外层 <label> 鼠标点得到,但 display:none 的输入框不在焦点序列里 ——
 * 键盘用户没有任何入口给物品加照片(实测:从顶栏连按 26 次 Tab 都没落到文件输入框上)。
 * 上面「表单控件都有可访问名称」那条查不到它,因为它把 file 类型排除了,
 * 而且按尺寸过滤(sr-only 的框只有 1px)。
 */
const fileInputState = () => page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  const describe = (node) => (node.getAttribute("aria-label") || node.closest("label")?.textContent?.trim().slice(0, 16) || "未命名");
  const unreachable = [];
  const nameless = [];
  for (const input of inputs) {
    const style = getComputedStyle(input);
    if (style.display === "none" || style.visibility === "hidden") {
      unreachable.push(describe(input));
      continue;
    }
    input.focus();
    if (document.activeElement !== input) unreachable.push(describe(input));
    input.blur();
    const labelled = Boolean(input.getAttribute("aria-label") || input.getAttribute("aria-labelledby"));
    const byLabel = Boolean(input.labels && input.labels.length && (input.labels[0].textContent || "").trim());
    if (!labelled && !byLabel) nameless.push(describe(input));
  }
  return { total: inputs.length, unreachable, nameless };
});

// ============ 0. 守卫:页面上得有可测的东西 ============
{
  const counts = await page.evaluate(() => ({
    inputs: document.querySelectorAll("input, textarea, select").length,
    focusable: document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
  }));
  check("页面上有足够的可聚焦元素(防止空跑)", counts.focusable >= 20, `focusable=${counts.focusable}`);
  check("页面上有表单控件(防止空跑)", counts.inputs >= 3, `inputs=${counts.inputs}`);
}

// ============ 0.5 文件输入框:键盘也到得了 ============
{
  const state = await fileInputState();
  check("物品页有文件输入框(防止空跑)", state.total >= 3, `total=${state.total}`);
  check("物品页的文件输入框都能 Tab 到(不是 display:none)", state.unreachable.length === 0, state.unreachable.slice(0, 3).join(" | "));
  check("物品页的文件输入框都有可访问名称", state.nameless.length === 0, state.nameless.slice(0, 3).join(" | "));
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
        // labels 包含显式(label[for])与隐式(label 包裹)两种关联,漏掉后者会误报
        const hasLabel = Boolean(node.labels && node.labels.length);
        return !(hasLabel || node.getAttribute("aria-label") || node.getAttribute("aria-labelledby") || (id && labelFor.has(id)) || node.getAttribute("placeholder"));
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
      // Next.js 开发模式的悬浮调试入口(nextjs-portal)也会被 Tab 到,它在生产构建里不存在,
      // 也不属于应用界面 —— 不排除掉的话,本地跑这套检查永远差一条。
      if (node.tagName === "NEXTJS-PORTAL" || node.closest("nextjs-portal")) return null;
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

// ============ 3. 弹窗:图片替代文本 + 焦点不逃逸 + Esc 可关 ============
if (!aiAvailable) {
  console.log("      跳过图片替代文本检查:本环境未配置 AI,「批量识别」入口会引导去设置页");
} else {
  const trigger = page.locator('button[aria-label="AI 批量识别物品"]').first();
  let dialogOpen = false;
  let detail = "点击后弹窗未出现";
  try {
    await trigger.waitFor({ state: "visible", timeout: 20000 });
    for (let attempt = 0; attempt < 2 && !dialogOpen; attempt += 1) {
      await trigger.click({ timeout: 10000 });
      await page.waitForTimeout(900);
      dialogOpen = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
    }
  } catch (error) {
    detail = error instanceof Error ? error.message.split("\n")[0].slice(0, 100) : String(error);
  }
  check("能打开「AI 批量识别」弹窗", dialogOpen, detail);

  if (dialogOpen) {
    const fileInput = page.locator('[role="dialog"] input[type="file"]').first();
    const hasFileInput = (await fileInput.count()) > 0;
    check("批量识别弹窗里有文件选择框", hasFileInput);

    const modalFileState = await fileInputState();
    check("批量识别弹窗的文件选择框能 Tab 到(不是 display:none)", modalFileState.unreachable.length === 0, modalFileState.unreachable.slice(0, 3).join(" | "));
    check("批量识别弹窗的文件选择框有可访问名称", modalFileState.nameless.length === 0, modalFileState.nameless.slice(0, 3).join(" | "));

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
          removeNamed: Array.from(document.querySelectorAll('[role="dialog"] button'))
            .filter((button) => (button.getAttribute("aria-label") || "").includes("移除")).length,
        };
      });
      check("图片预览确实渲染出来了(防止空跑)", state.total > 0, `img=${state.total}`);
      check("图片预览都有替代文本(alt)", state.missing.length === 0, state.missing.slice(0, 3).join(" | "));
      check("预览上的移除按钮有可访问名", state.removeNamed > 0, `命中=${state.removeNamed}`);
    }

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

// ============ 4. 录入物品弹窗:图片上传入口也要能 Tab 到 ============
{
  const trigger = page.locator('button[aria-label="录入物品"]').first();
  if ((await trigger.count()) === 0) {
    check("能找到「录入物品」入口", false, "顶栏没有录入物品按钮(上传入口没被测到)");
  } else {
    await trigger.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const opened = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
    check("能打开「录入物品」弹窗", opened, "点击后没有弹窗");
    if (opened) {
      // 图片上传入口在「图片」折叠行里,默认收起 —— 先展开再量。
      await page.locator('[role="dialog"] button[aria-expanded]:has-text("图片")').first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      const state = await fileInputState();
      check("录入物品弹窗有文件输入框(防止空跑)", state.total >= 1, `total=${state.total}`);
      check("录入物品弹窗的文件输入框能 Tab 到(不是 display:none)", state.unreachable.length === 0, state.unreachable.slice(0, 3).join(" | "));
      check("录入物品弹窗的文件输入框有可访问名称", state.nameless.length === 0, state.nameless.slice(0, 3).join(" | "));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
  }
}

// ============ 5. 设置页:数据与备份里的两个导入入口 ============
{
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  // 这两个入口在折叠的 <details> 分组里,先展开。
  await page.evaluate(() => {
    document.querySelectorAll("main details:not([open])").forEach((node) => {
      const summary = node.querySelector("summary");
      if (summary instanceof HTMLElement) summary.click();
    });
  });
  await page.waitForTimeout(1200);
  const state = await fileInputState();
  check("设置页有文件输入框(防止空跑)", state.total >= 2, `total=${state.total}`);
  check("设置页的文件输入框都能 Tab 到(不是 display:none)", state.unreachable.length === 0, state.unreachable.slice(0, 3).join(" | "));
  check("设置页的文件输入框都有可访问名称", state.nameless.length === 0, state.nameless.slice(0, 3).join(" | "));
}

// ============ 6 AI 设置的模型选择器:写了 listbox 就得有方向键 ============
// 这个下拉此前写着 aria-haspopup="listbox" + role="listbox" + role="option",
// 却一条键盘交互都没有:实测打开后焦点留在触发按钮上、方向键不动、Esc 也关不掉
// (只有一个「点外面关闭」的监听)。读屏会明确告诉用户「这是列表,用方向键选」,
// 按下去却毫无反应 —— 契约写了就得兑现。
// 需要真的能拉到模型列表(即配好了 AI),否则这一节跳过而不是判红。
if (!aiAvailable) {
  console.log("      跳过模型选择器键盘检查:本环境未配置 AI,拉不到模型列表");
} else {
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  await page.evaluate(() => { document.querySelectorAll("main details").forEach((node) => { node.open = true; }); });
  await page.waitForTimeout(800);

  const trigger = page.locator('button[aria-label="拉取并选择模型"]').first();
  if ((await trigger.count()) === 0) {
    check("能找到模型选择器入口", false, "设置页没有「拉取并选择模型」按钮");
  } else {
    // 「欢迎使用」与「提醒中心」这两个弹层是**自己会弹**的,而且可能晚一步出现:
    // 只在这之前清一次,偶尔会正好落在「清完 → 它弹出来 → 按钮被盖住」的缝里。
    // 那会让这一节以「options=0」的形式假失败(实测撞到过一次,单跑却 34/34 全绿)。
    // 所以点之前再清一次,点不动就重试一次,并且**明确说出**是点不动而不是拉不到。
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt += 1) {
      await dismissBlockingDialogs(page);
      clicked = await trigger.click({ timeout: 6000 }).then(() => true).catch(() => false);
      if (!clicked) await page.waitForTimeout(800);
    }
    check("能点到模型选择器入口(没有被自动弹出的弹层挡住)", clicked, "按钮被弹层盖住,点不动");
    await page.waitForTimeout(3500);
    const opened = clicked ? await page.evaluate(() => {
      const listbox = document.querySelector('[role="listbox"]');
      const options = listbox ? [...listbox.querySelectorAll('[role="option"]')] : [];
      const inside = listbox ? listbox.contains(document.activeElement) : false;
      return {
        options: options.length,
        roles: options.map((node) => node.getAttribute("role")),
        tabIndexes: [...new Set(options.map((node) => node.tabIndex))],
        focusInside: inside,
        activeText: inside ? (document.activeElement?.textContent || "").trim().slice(0, 24) : null,
        error: document.querySelector('[role="listbox"] .text-red-500')?.textContent?.slice(0, 40) ?? null,
        controls: document.querySelector('button[aria-label="拉取并选择模型"]')?.getAttribute("aria-controls") ?? null,
      };
    }) : { options: -1, roles: [], tabIndexes: [], focusInside: false, activeText: null, error: "入口点不动", controls: null };
    check("模型选择器真的拉到了选项(否则这一节等于没测)", opened.options >= 2, `options=${opened.options} error=${opened.error}`);
    check("选项是 role=option(列表的语义)", opened.options > 0 && opened.roles.every((role) => role === "option"), JSON.stringify(opened.roles));
    check("触发按钮用 aria-controls 指向这张列表", opened.controls === "ai-model-listbox", `aria-controls=${opened.controls}`);
    check("打开后焦点进入列表(方向键才有意义)", opened.focusInside, `active=${opened.activeText ?? "(不在列表内)"}`);

    if (opened.options >= 2 && opened.focusInside) {
      const focusText = () => page.evaluate(() => (document.activeElement?.textContent || "").trim().slice(0, 24));
      const start = await focusText();
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      const down = await focusText();
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(200);
      const up = await focusText();
      check("↓ 能把焦点移到下一个选项", down !== start, `${start} → ${down}`);
      check("↑ 能回到上一个选项", up === start, `${down} → ${up}`);

      await page.keyboard.press("End");
      await page.waitForTimeout(200);
      const end = await focusText();
      await page.keyboard.press("Home");
      await page.waitForTimeout(200);
      const home = await focusText();
      check("End / Home 能跳到首尾", end !== home && home === start, `End=${end} Home=${home}`);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      const closed = await page.evaluate(() => ({
        open: Boolean(document.querySelector('[role="listbox"]')),
        focusOnTrigger: document.activeElement?.getAttribute("aria-label") === "拉取并选择模型",
      }));
      check("Esc 能关掉列表并把焦点还给触发按钮", !closed.open && closed.focusOnTrigger, JSON.stringify(closed));
    }
  }
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);