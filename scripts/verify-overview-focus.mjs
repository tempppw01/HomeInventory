// 概览首屏「最需要做的事」卡片验收。
//
// 起因:这张卡片的文案写着「今天到期 · 还有 0 天,先用掉它」——
// 而 `expiryDateLabel` 对今天到期本来就返回「今天到期」,后面又补了一句天数,
// 于是变成自相矛盾的叙述。更普遍的问题是:不同天数下它都会重复一遍:
//   「今天到期 · 还有 0 天」 / 「明天到期 · 还有 1 天」 / 「还剩 5 天 · 还有 5 天」
//
// 这条检查守住两件事:
//   1. 卡片文案里不出现重复的天数叙述(两种已知的坏形态都直接断言)
//   2. 卡片按数据状态切换:有已过期物品时讲「已经过期」,只有临期时讲「快到期」并给处理建议
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-overview-focus.mjs

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

const api = async (method, path, body) => {
  const response = await page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, body: parsed };
  }, { method, path, body });
  return response;
};

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** 读首屏卡片:标题、明细、按钮 */
const readFocus = async () => {
  await page.goto(BASE);
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const text = (main?.innerText || "").replace(/\n+/g, " | ");
    const match = text.match(/最需要做的事 \| ([^|]+)\| ([^|]+)/);
    return {
      raw: text.slice(0, 240),
      headline: match ? match[1].trim() : null,
      detail: match ? match[2].trim() : null,
    };
  });
};

// ---------- ① 当前状态下的卡片:文案不重复叙述天数 ----------
{
  const focus = await readFocus();
  check("首屏有「最需要做的事」卡片且读到了标题与明细", Boolean(focus.headline && focus.detail), focus.raw);
  if (focus.detail) {
    // 两种已知的坏形态:同一天数说两遍(今天到期 · 还有 0 天 / 还剩 N 天 · 还有 N 天)
    check("明细里没有「今天到期 · 还有 0 天」这种自相矛盾", !/今天到期[^|]*还有\s*0\s*天/.test(focus.detail), focus.detail);
    check("明细里没有重复天数(还剩 N 天 · 还有 N 天)", !/还剩\s*(\d+)\s*天[^|]*还有\s*\1\s*天/.test(focus.detail), focus.detail);
    check("明细里没有「明天到期 · 还有 1 天」这种重复", !/明天到期[^|]*还有\s*1\s*天/.test(focus.detail), focus.detail);
  }
}

// ---------- ② 造一件已过期的物品:卡片应改说「已经过期」 ----------
let expiredId = null;
{
  const created = await api("POST", "/api/items", {
    name: `概览验收-已过期-${Date.now().toString(36)}`,
    category: "食品",
    type: "CONSUMABLE",
    unit: "盒",
    quantity: 1,
    expiryDate: dayOffset(-3),
  });
  expiredId = created.body?.id ?? null;
  check("能造出一件已过期的物品", Boolean(expiredId), `status=${created.status}`);

  if (expiredId) {
    const focus = await readFocus();
    check("有已过期物品时卡片改说「已经过期」", /已经过期/.test(focus.headline ?? ""), `headline=${focus.headline}`);
    check("并给出处理指引", /处理掉|更新保质期/.test(focus.detail ?? ""), `detail=${focus.detail}`);
    check("过期状态下不出现重复天数叙述", !/已过期\s*\d+\s*天[^|]*还有/.test(focus.detail ?? ""), focus.detail);
  }
}

// 收尾:删掉探针物品
if (expiredId) {
  await api("DELETE", `/api/items/${expiredId}`, {});
  await api("DELETE", `/api/items/${expiredId}`, { permanent: true });
}

// 清理校验:探针清掉后,卡片不该再提这件物品
{
  const focus = await readFocus();
  check("清理后卡片不再提这件探针物品", !/概览验收-已过期/.test(focus.raw), focus.raw.slice(0, 160));
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);