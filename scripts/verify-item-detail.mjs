// 物品详情页验收(/items/[id])。
//
// 这页在 (app) 布局之外 —— 没有 AppProvider、toast、AI 助手,
// 所以它的反馈方式与列表页不同(靠按钮文案/页面数值变化),很容易被遗漏。
// 它的主要用途是「扫码看这件东西」,因此重点验证:数据看得全、常用操作真的改数据。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-item-detail.mjs

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

// 造一件带余量语义的消耗品(液体),用完即删
const created = await page.evaluate(async () => {
  const response = await fetch("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "详情页验收饮品", category: "饮品", type: "CONSUMABLE", unit: "瓶", quantity: 3, remainingPercent: 100 }),
  });
  const body = await response.json();
  return { id: body.id, status: response.status };
});
check("创建探针物品", created.status === 201 || created.status === 200, `status=${created.status}`);
if (!created.id) {
  await context.close();
  await browser.close();
  process.exit(1);
}

const detailUrl = `${BASE}/items/${created.id}`;
const readApi = async () => page.evaluate(async (id) => {
  const response = await fetch(`/api/items/${id}`, { cache: "no-store" });
  const body = await response.json();
  return { percent: body.remainingPercent, quantity: body.quantity };
}, created.id);
const readUi = async () => page.evaluate(() => {
  const text = (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | ");
  const percent = /当前剩余量 \| (\d+)%/.exec(text);
  return { percent: percent ? Number(percent[1]) : null, text };
});

await page.goto(detailUrl);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);

// ① 页面骨架:基本信息、位置与数量、日期与价格、变更记录
{
  const ui = await readUi();
  check("详情页渲染了物品名称", ui.text.includes("详情页验收饮品"), ui.text.slice(0, 120));
  check("详情页有「基本信息」小节", ui.text.includes("基本信息"));
  check("详情页有「位置与数量」小节", ui.text.includes("位置与数量"));
  check("详情页有「变更记录」小节", ui.text.includes("变更记录"));
  check("详情页能返回列表", ui.text.includes("返回归物"));
}

// ② 余量减少 10% → 数据变化且页面数值立刻更新(不需要刷新)
{
  const before = { api: await readApi(), ui: await readUi() };
  await page.locator('button[aria-label="余量减少 10%"]').first().click();
  await page.waitForTimeout(2200);
  const after = { api: await readApi(), ui: await readUi() };

  check("「少 10%」真的改了数据", after.api.percent === before.api.percent - 10, `${before.api.percent}% → ${after.api.percent}%`);
  check("页面数值立刻跟着更新(无需刷新)", after.ui.percent === after.api.percent, `页面=${after.ui.percent}% 接口=${after.api.percent}%`);

  await page.locator('button[aria-label="余量重置为 100%"]').first().click();
  await page.waitForTimeout(2200);
  const reset = await readApi();
  check("「满上」把余量重置为 100%", reset.percent === 100, `实际=${reset.percent}%`);
}

// ③ 复制编号:要有可见反馈
{
  await page.locator('button[aria-label="复制物品编号"]').first().click();
  await page.waitForTimeout(1200);
  const ui = await readUi();
  check("复制编号后给出反馈", /已复制|复制成功/.test(ui.text), "没有任何反馈");
}

// ④ 重新分析:配了 AI 才测(未配则跳过并说明)
{
  const aiAvailable = await page.evaluate(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      return Boolean((await response.json()).aiAvailable);
    } catch { return false; }
  });

  if (!aiAvailable) {
    console.log("      跳过「重新分析」:本环境未配置 AI");
  } else {
    await page.locator('button[aria-label^="重新分析"]').first().click();
    // AI 有延迟,最多等 25 秒看按钮是否变成反馈文案
    let state = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(2000);
      state = await page.evaluate(() => {
        const button = document.querySelector('button[aria-label^="重新分析"]');
        const text = (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | ");
        return {
          label: (button?.textContent || "").trim(),
          disabled: Boolean(button?.disabled),
          errorLike: /失败|错误|不可用|超时/.test(text),
        };
      });
      if (state.label.includes("已更新") || state.errorLike) break;
    }
    check("重新分析给出明确结果(成功或错误提示)", Boolean(state) && (state.label.includes("已更新") || state.errorLike), JSON.stringify(state).slice(0, 120));
  }
}

// 清理探针物品
await page.evaluate(async (id) => {
  await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) });
}, created.id);

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);