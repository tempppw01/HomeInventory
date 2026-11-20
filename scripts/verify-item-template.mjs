// 物品模板功能验收(此前零覆盖)。
//
// 模板存在浏览器 localStorage:在「录入物品」里把当前表单存为模板,
// 下次录入时以 chip 形式出现,点一下就能带出名称/分类/单位等。
//
// 同时守住一条容易被忽略的交互约定:**成功提示不能走错误通道** ——
// 之前「模板已保存」是用 setError() 显示的,渲染出来是红字粉底,
// 用户会以为自己操作失败了。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-item-template.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const TEMPLATE_NAME = "模板验收物品";

// 颜色判断不解析格式(浏览器可能给 oklch、rgb 等等),
// 而是直接和**应用自己的 token 颜色**比对:同一个 var(--danger) 渲染出来必然完全一致。
const tokenColor = (token) =>
  page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${value})`;
    probe.style.position = "fixed";
    probe.style.opacity = "0";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const results = [];
let errorNoticeColor = null;
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

// 从干净状态开始:清掉已有模板
const openItemModal = async () => {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);
  await page.locator('button[aria-label="录入物品"]').first().click({ timeout: 15000 });
  await page.waitForTimeout(1000);
};

await page.goto(`${BASE}/items`);
await page.waitForTimeout(2200);
await page.evaluate(() => localStorage.removeItem("home-inventory-item-templates-v1"));
await openItemModal();

// ① 没填名称就存模板 → 明确报错
{
  const saveButton = page.locator('[role="dialog"] button:has-text("存为模板")').first();
  check("录入物品弹窗里有「存为模板」入口", (await saveButton.count()) > 0);
  await saveButton.click();
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const node = Array.from(document.querySelectorAll('[role="dialog"] p')).find((n) => (n.textContent || "").includes("先填写物品名称"));
    if (!node) return null;
    const style = getComputedStyle(node);
    return { text: (node.textContent || "").trim(), color: style.color, background: style.backgroundColor };
  });
  check("没填名称时给出提示", Boolean(state), "没有出现提示");
  errorNoticeColor = state?.color ?? null;
  if (state) {
    const successColor = await tokenColor("--success");
    check("错误提示的配色与成功提示不同(用户能区分)", state.color !== successColor, `错误=${state.color} 成功=${successColor}`);  }
}

// ② 填名称后保存 → 成功提示用「成功色」而不是错误色
{
  await page.locator('[role="dialog"] input#item-name').first().fill(TEMPLATE_NAME);
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] button:has-text("存为模板")').first().click();
  await page.waitForTimeout(700);

  const state = await page.evaluate(() => {
    const node = Array.from(document.querySelectorAll('[role="dialog"] p')).find((n) => (n.textContent || "").includes("模板已保存"));
    if (!node) return null;
    const style = getComputedStyle(node);
    return { text: (node.textContent || "").trim(), color: style.color, background: style.backgroundColor };
  });
  check("保存模板后有确认提示", Boolean(state), "没有出现提示");
  if (state) {
    const successColor = await tokenColor("--success");
    const dangerColor = await tokenColor("--danger");
    check("这条确认用的是成功色(--success)", state.color === successColor, `实际=${state.color} 期望=${successColor}`);
    check("成功提示与错误提示的颜色确实不同", Boolean(errorNoticeColor) && state.color !== errorNoticeColor, `成功=${state.color} 错误=${errorNoticeColor}`);
  }

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("home-inventory-item-templates-v1");
    try { return JSON.parse(raw || "[]"); } catch { return null; }
  });
  check("模板已写入浏览器存储", Array.isArray(stored) && stored.some((entry) => entry.name === TEMPLATE_NAME), `条数=${stored?.length}`);
}

// ③ 重新打开录入弹窗 → 模板以 chip 出现,点一下能带出名称
{
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await openItemModal();

  const chip = page.locator(`[role="dialog"] button:has-text("${TEMPLATE_NAME}")`).first();
  const chipCount = await chip.count();
  check("重新录入时能看到刚才的模板", chipCount > 0, "没有出现模板入口");

  if (chipCount > 0) {
    await chip.click();
    await page.waitForTimeout(600);
    const filled = await page.locator('[role="dialog"] input#item-name').first().inputValue();
    check("点模板能带出物品名称", filled === TEMPLATE_NAME, `实际=${filled}`);
  }
}

// ④ 数量上限:模板最多 8 条(超出的会被裁掉)
{
  await page.evaluate((name) => {
    const key = "home-inventory-item-templates-v1";
    const now = Date.now();
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `probe-${index}`,
      name: `${name}-${index}`,
      category: "日用",
      type: "CONSUMABLE",
      unit: "件",
      quantity: 1,
      minQuantity: 0,
      remainingPercent: 100,
      usedAt: now - index,
    }));
    localStorage.setItem(key, JSON.stringify(many));
  }, TEMPLATE_NAME);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await openItemModal();
  const shown = await page.evaluate((name) => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter((n) => n.getBoundingClientRect().height > 0).pop();
    if (!dialog) return -1;
    return Array.from(dialog.querySelectorAll("button")).filter((b) => (b.textContent || "").includes(name)).length;
  }, TEMPLATE_NAME);
  check("模板条数受上限约束(不会无限堆)", shown >= 0 && shown <= 8, `显示 ${shown} 条`);
}

// 清理:把探针模板删掉,避免影响后续套件
await page.evaluate(() => localStorage.removeItem("home-inventory-item-templates-v1"));

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);