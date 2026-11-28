// 物品详情页验收(/items/[id])。
//
// 这页在 (app) 布局之外 —— 没有 AppProvider、toast、AI 助手,
// 所以它的反馈方式与列表页不同(靠按钮文案/页面数值变化),很容易被遗漏。
// 它的主要用途是「扫码看这件东西」,因此重点验证:数据看得全、常用操作真的改数据。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-item-detail.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";
import { loginCookie } from "./lib/probe-login.mjs";

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

// 1.5 顶部照片位:没有照片时不能再是一块 208px 的空白
//
// 此前这一块是 h-52(208px)的空色块 + 一个装饰图标,390×844 实测把物品名推到 y=317;
// 而详情页本身没有任何上传入口(加照片只能绕回列表卡片右键,或进「编辑物品」的图片折叠行)。
// 现在空态收成 96px,并就地给出键盘到得了的上传入口。
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(detailUrl);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);

  const empty = await page.evaluate(() => {
    const article = document.querySelector("article");
    const band = article?.firstElementChild;
    const name = article?.querySelector("h1");
    const input = document.querySelector('input[type="file"]');
    const box = (node) => { const rect = node?.getBoundingClientRect(); return rect ? { top: Math.round(rect.top + window.scrollY), height: Math.round(rect.height) } : null; };
    let focusable = false;
    if (input) { input.focus(); focusable = document.activeElement === input; input.blur(); }
    const nameBox = box(name);
    const bandBox = box(band);
    return {
      band: bandBox,
      nameTop: nameBox?.top ?? null,
      // 照片位底边与物品名之间不该再夹着一段空白
      gapToName: bandBox && nameBox ? nameBox.top - (bandBox.top + bandBox.height) : null,
      hasUpload: Boolean(input),
      uploadFocusable: focusable,
      uploadName: input ? (input.getAttribute("aria-label") || "") : "",
      text: (band?.innerText || "").replace(/\n+/g, " | "),
    };
  });
  check("没有照片时顶部区块不再是 208px 的空白(≤120px)", Boolean(empty.band) && empty.band.height <= 120, JSON.stringify(empty.band));
  check("照片位与物品名之间没有多余留白(≤40px)", empty.gapToName !== null && empty.gapToName <= 40, `gap=${empty.gapToName} nameTop=${empty.nameTop}`);
  check("没有照片时详情页就地给出上传入口", empty.hasUpload && /上传照片/.test(empty.text), empty.text.slice(0, 80));
  check("上传入口键盘到得了(不是 display:none)", empty.uploadFocusable, JSON.stringify({ has: empty.hasUpload, focusable: empty.uploadFocusable }));
  check("上传入口有可访问名", /^给「.+」上传照片$/.test(empty.uploadName), `aria-label=${empty.uploadName}`);

  // 对照:有照片时仍然显示照片位,而不是空态
  // (imageUrl 的校验只收完整 URL 或 /api/uploads/... 内部路径,所以这里用一个完整 URL)
  const staged = await page.evaluate(async (id) => {
    const response = await fetch(`/api/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageUrl: "https://example.com/photo.png" }) });
    return response.status;
  }, created.id);
  check("能把这件物品设成有照片(用于对照)", staged === 200, `status=${staged}`);
  await page.goto(detailUrl);
  await page.waitForTimeout(2600);
  const filled = await page.evaluate(() => {
    const band = document.querySelector("article")?.firstElementChild;
    const rect = band?.getBoundingClientRect();
    return { height: rect ? Math.round(rect.height) : null, text: (band?.innerText || "").trim().slice(0, 40), background: band ? getComputedStyle(band).backgroundImage.slice(0, 30) : null };
  });
  check("有照片时显示的是照片位(≥240px)", filled.height !== null && filled.height >= 240, JSON.stringify(filled));
  check("有照片时不再显示「还没有照片」", !/还没有照片/.test(filled.text), filled.text);

  await page.evaluate(async (id) => {
    await fetch(`/api/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageUrl: "" }) });
  }, created.id);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(detailUrl);
  await page.waitForTimeout(2400);
}

// 1.6 只读账号:详情页不该出现「上传照片」
//
// 接口本来就会拦只读写操作(403),界面上也不该出现点了会被拒的按钮 —— 这是全站一贯的口径。
{
  const viewerUser = process.env.PROBE_VIEWER_USER || "viewcheck";
  const viewerPass = process.env.PROBE_VIEWER_PASS || "View#2026";
  let cookie = null;
  let why = "";
  try {
    cookie = await loginCookie(BASE, viewerUser, viewerPass);
  } catch (error) {
    why = error instanceof Error ? error.message : String(error);
  }
  if (!cookie) {
    check("只读账号能登录(否则这一节等于没测)", false, `拿不到 ${viewerUser} 的会话:${why}`);
  } else {
    const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const split = cookie.indexOf("=");
    await viewerContext.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: BASE }]);
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`${BASE}/items/${created.id}`);
    await viewerPage.waitForTimeout(2600);
    const state = await viewerPage.evaluate(() => {
      const band = document.querySelector("article")?.firstElementChild;
      return { text: (band?.innerText || "").replace(/\n+/g, " | "), uploads: document.querySelectorAll('input[type="file"]').length };
    });
    check("只读账号在详情页看不到上传入口", state.uploads === 0 && !/上传照片/.test(state.text), JSON.stringify(state));
    check("只读账号仍看得到「还没有照片」的说明", /还没有照片/.test(state.text), state.text.slice(0, 60));
    await viewerContext.close();
  }
}

// ② 余量减少 10% → 数据变化且页面数值立刻更新(不需要刷新)
{
  const before = { api: await readApi(), ui: await readUi() };
  await page.locator('button[aria-label="少 10%,余量减少 10%"]').first().click();
  await page.waitForTimeout(2200);
  const after = { api: await readApi(), ui: await readUi() };

  check("「少 10%」真的改了数据", after.api.percent === before.api.percent - 10, `${before.api.percent}% → ${after.api.percent}%`);
  check("页面数值立刻跟着更新(无需刷新)", after.ui.percent === after.api.percent, `页面=${after.ui.percent}% 接口=${after.api.percent}%`);

  await page.locator('button[aria-label="满上,余量重置为 100%"]').first().click();
  await page.waitForTimeout(2200);
  const reset = await readApi();
  check("「满上」把余量重置为 100%", reset.percent === 100, `实际=${reset.percent}%`);
}

// ③ 上次补货:有值时显示相对时间(这个字段此前只写不显示)
{
  const stamp = new Date(Date.now() - 3 * 86400000 - 3600000).toISOString(); // 3 天零 1 小时前
  await page.evaluate(async ({ id, value }) => {
    await fetch(`/api/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ lastRestockedAt: value }) });
  }, { id: created.id, value: stamp });
  await page.reload();
  await page.waitForTimeout(2600);

  const ui = await readUi();
  const segment = /上次补货 \| ([^|]+)/.exec(ui.text);
  check("显示了「上次补货」", Boolean(segment), ui.text.slice(0, 160));
  check("相对时间按时刻算(3 天前,不是 4 天前)", Boolean(segment) && segment[1].trim() === "3 天前", segment ? `实际=${segment[1].trim()}` : "没有这一行");
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
    await page.locator('button[title^="让 AI 重新看一遍"]').first().click();
    // AI 有延迟,最多等 25 秒看按钮是否变成反馈文案
    let state = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(2000);
      state = await page.evaluate(() => {
        const button = document.querySelector('button[title^="让 AI 重新看一遍"]');
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

// ---------- 8 「AI 说」必须写清是何时算的、之后有没有改过 ----------
// 由来(2026-11-29 实测):这一页原先从「最近 12 条变更记录」里找 AI_ANALYZE 的时间,
// 窗口一满就找不到 → 「AI 什么时候看过这件」静默消失,连「结论已过时」也判不出来。
// 而列表页走 /api/dashboard 的 groupBy,明明已经给同一件挂了「建议重新分析」——
// 点进详情页却什么提示都没有,一条「当前有 3 盒」(实际 6 盒)的旧结论看起来像刚算的。
{
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const seededIds = [];
  const detailWithBust = () => `${BASE}/items/${created.id}?probe=${Date.now()}`;
  try {
    // 先清掉先前步骤(「重新分析」那条)可能写下的 AI_ANALYZE,保证夹具确定
    await prisma.activityLog.deleteMany({ where: { itemId: created.id, action: "AI_ANALYZE" } });
    const analyzedAt = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    seededIds.push((await prisma.activityLog.create({
      data: { action: "AI_ANALYZE", itemId: created.id, itemName: "详情页验收饮品", detail: "详情页验收:AI 分析", createdAt: analyzedAt },
      select: { id: true },
    })).id);
    // 13 条更晚的改动,足以把上面那条挤出「最近 12 条」
    for (let index = 0; index < 13; index += 1) {
      seededIds.push((await prisma.activityLog.create({
        data: { action: "UPDATE", itemId: created.id, itemName: "详情页验收饮品", detail: `详情页验收:第 ${index + 1} 次改动`, createdAt: new Date(analyzedAt.getTime() + (index + 1) * 60_000) },
        select: { id: true },
      })).id);
    }
    // 有 AI 结论、且物品在那之后又被改过(update 会把 updatedAt 推到 now)
    await prisma.item.update({ where: { id: created.id }, data: { aiSummary: "详情页验收:这是 AI 当时写的结论。" } });

    const rowsForItem = await prisma.activityLog.count({ where: { itemId: created.id } });
    check("(前置)AI 分析那条确实被挤出了最近 12 条窗口", rowsForItem > 12, `该物品变更记录共 ${rowsForItem} 条`);

    await page.goto(detailWithBust(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const staleText = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));
    check(
      "窗口满了也照样写出「AI 什么时候看过这件」",
      staleText.includes("看过这件"),
      staleText.slice(staleText.indexOf("AI 说"), staleText.indexOf("AI 说") + 160),
    );
    check(
      "分析之后物品改过,详情页也明说结论可能已不准确(与列表页同一个判定)",
      staleText.includes("可能已不准确"),
      staleText.slice(staleText.indexOf("AI 说"), staleText.indexOf("AI 说") + 200),
    );

    // 没有 AI_ANALYZE 记录(录入时算的旧数据)时,不许装作「刚算的」,也不许装作有时间
    await prisma.activityLog.deleteMany({ where: { itemId: created.id, action: "AI_ANALYZE" } });
    await page.goto(detailWithBust(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const noTimeText = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));
    check(
      "查不到分析时间时说「生成时间没有记录」,而不是留空让人以为是刚算的",
      noTimeText.includes("生成时间没有记录") && !noTimeText.includes("看过这件"),
      noTimeText.slice(noTimeText.indexOf("AI 说"), noTimeText.indexOf("AI 说") + 160),
    );
  } finally {
    // 收尾必须删掉这些活动记录:ActivityLog.itemId 是 onDelete: SetNull,
    // 删物品不会带走它们,会变成孤儿行留在库里(套件卫生检查会红)。
    await prisma.activityLog.deleteMany({ where: { id: { in: seededIds } } }).catch(() => undefined);
    await prisma.activityLog.deleteMany({ where: { itemId: created.id } }).catch(() => undefined);
    await prisma.$disconnect();
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