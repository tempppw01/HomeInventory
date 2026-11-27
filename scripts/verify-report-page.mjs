// 打印月报页(/report)的验收检查。
//
// 单独成篇的原因:这一页是服务端组件,曾经把函数(valueFormatter)传给客户端图表组件,
// React 无法序列化函数 → 整页 500。当时没有任何检查覆盖到它,直到手动点开才发现。
// 这类「服务端组件 + 客户端组件」的边界问题值得一条常驻检查。

import { launchChromiumOrNull } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromiumOrNull();
if (!browser) {
  console.log("跳过:当前环境没有可用的 Chromium");
  process.exit(0);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 120)); });

// 登录并确认:没登进去的话,后面测的都是登录页
const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("月报检查已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  const early = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - early.length}/${results.length} 通过`);
  process.exit(1);
}
await dismissBlockingDialogs(page);

const response = await page.goto(`${BASE}/report`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const status = response ? response.status() : 0;

const state = await page.evaluate(() => {
  const text = document.body.innerText || "";
  return {
    title: text.includes("家庭月报"),
    boundary: text.includes("页面没能加载出来"),
    sections: ["要到期了", "快用完了", "该放冰箱的", "该补货的"].filter((label) => text.includes(label)).length,
    chartBars: document.querySelectorAll('svg[viewBox^="0 0 100"] rect').length,
    shareAria: document.querySelector('[role="img"][aria-label^="本月消费分类占比"]')?.getAttribute("aria-label") ?? null,
    printButton: Array.from(document.querySelectorAll("button")).some((button) => (button.textContent || "").includes("打印")),
    monthLabel: /\d{4} 年 \d{1,2} 月/.test(text),
    text,
  };
});

check("月报页返回 200 且没有落进错误边界", status === 200 && !state.boundary, `status=${status} boundary=${state.boundary}`);
check("月报页显示标题与四个小节", state.title && state.sections === 4, `title=${state.title} sections=${state.sections}`);
check("月报页有月份标签", state.monthLabel, `monthLabel=${state.monthLabel}`);
check("月报页图表正常渲染(柱状 + 占比)", state.chartBars > 0 && Boolean(state.shareAria), `bars=${state.chartBars} share=${state.shareAria}`);

// ---------- 数字要能和别的页面/接口对上 ----------
// 由来(实测):月报的「物品 N 件」多了一个 `quantity > 0` 的过滤,而概览接口不过滤 ——
// 同一份数据,概览说 4 件、月报说 3 件(用完但还留着等补货的那件在月报里"消失")。
// 这里拿两边的数字直接对账,任何一边改了口径都会红。用现场数据即可,不需要造数。
{
  const onPage = Number((state.text.match(/物品\s*([0-9]+)\s*件/) ?? [])[1] ?? NaN);
  const dashboard = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const json = await response.json().catch(() => null);
    return { status: response.status, count: Array.isArray(json?.items) ? json.items.length : -1 };
  });
  check(
    "月报的「物品」件数与概览接口一致(同一份数据不许两个数字)",
    Number.isFinite(onPage) && dashboard.count > 0 && onPage === dashboard.count,
    `月报=${Number.isFinite(onPage) ? onPage : "(没读到)"} 概览=${dashboard.count}`,
  );
  // 估算价值也顺带核一次:两处都该是 Σ(价格×数量)
  const sumPriceQuantity = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const json = await response.json().catch(() => null);
    return (json?.items ?? []).reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  });
  const valueOnPage = Number((state.text.match(/估算价值\s*[¥￥]\s*([0-9]+)/) ?? [])[1] ?? NaN);
  check(
    "月报的「估算价值」等于 Σ(价格×数量)",
    Number.isFinite(valueOnPage) && Math.abs(valueOnPage - Math.round(sumPriceQuantity)) <= 1,
    `月报=${Number.isFinite(valueOnPage) ? valueOnPage : "(没读到)"} 手算=${Math.round(sumPriceQuantity)}`,
  );
}
// 月份标签必须落在柱子的正下方。此前标签行用 flex justify-between 铺满整行,
// 首尾两个会跑到柱子外侧(1440px 宽实测偏 137px),读者会把标签认到隔壁柱子上。
const axis = await page.evaluate(() => {
  const rows = [];
  for (const figure of document.querySelectorAll('figure[role="img"]')) {
    const svg = figure.querySelector("svg");
    if (!svg) continue;
    const bars = [...svg.querySelectorAll("rect")];
    const labels = [...figure.querySelectorAll("div > span")];
    if (!bars.length || bars.length !== labels.length) continue;
    let worst = 0;
    bars.forEach((bar, index) => {
      const b = bar.getBoundingClientRect();
      const l = labels[index].getBoundingClientRect();
      worst = Math.max(worst, Math.abs((b.left + b.width / 2) - (l.left + l.width / 2)));
    });
    rows.push({ count: bars.length, worst: Number(worst.toFixed(1)) });
  }
  return rows;
});
check(
  "月份标签与柱子逐一对齐(偏差 ≤ 2px)",
  axis.length > 0 && axis.every((row) => row.worst <= 2),
  JSON.stringify(axis),
);
check("月报页有打印按钮", state.printButton, `printButton=${state.printButton}`);
// 天数叙述必须说人话:今天到期就写「今天到期」,不能出现「0 天后到期」。
// (这条是全站统一的重灾区:概览卡片、月报、支出预测以前都各自用 Math.max(0, days) 拼天数)
check("月报里没有「0 天后」这类说法", !/0\s*天后|还有\s*0\s*天/.test(state.text), (state.text.match(/.{0,12}0\s*天后.{0,12}/) ?? [""])[0]);
check("临期条目用的是「今天到期 / N 天后到期 / 已过期 N 天」的说法", /今天到期|天后到期|已过期/.test(state.text), state.text.slice(0, 100));
// ---------- 临期窗口:月报与空间卡都必须跟用户设置走 ----------
//
// 起因(2026-11-27 修):月报用固定 30 天(判定函数的默认参数)、空间卡写死 7 天
// 且把**已过期**的算进「临期」,而概览/提醒中心/物品卡都用用户设置的「保质期提前 N 天」。
// 同一份数据实测:提醒中心说 9 件要到期,月报说 12 件、空间卡说 6 件。
//
// 这一节自己造一件空间+五件物品,把窗口改成 7 与 30 各量一遍,期望值由本脚本
// 用同一份 /api/dashboard 数据独立重算(不写死数字),跑完把偏好与数据都还回去。
const PROBE_SPACE = "月报窗口探针台";
{
  const api = (method, path, body) => page.evaluate(async (request) => {
    const response = await fetch(request.path, {
      method: request.method,
      cache: "no-store",
      headers: request.body ? { "content-type": "application/json" } : undefined,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    return { status: response.status, body: parsed };
  }, { method, path, body });

  /** 与 lib/expiry-status 的 daysUntilLocalDay 同一个口径:两侧都归到本地那天的 00:00 */
  const expiryState = () => page.evaluate(async () => {
    const data = await fetch("/api/dashboard", { cache: "no-store" }).then((r) => r.json());
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const days = (item) => {
      // 注意:new Date(null) 是 1970-01-01(不是 Invalid Date)—— 没有有效期的物品
      // 必须先挡掉,否则会被当成「已过期 两万年」,重算的数字永远比页面对不上。
      if (!item.expiryDate) return null;
      const target = new Date(item.expiryDate);
      if (Number.isNaN(target.getTime())) return null;
      return Math.round((new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() - startOfToday) / 86400000);
    };
    const rows = (data.items ?? []).map((item) => ({ name: item.name, locationId: item.locationId, days: days(item) })).filter((row) => row.days !== null);
    return {
      preference: data.preferences?.expiryReminderDays ?? null,
      all: rows,
      totals: { expired: rows.filter((row) => row.days < 0).length },
    };
  });

  const localDay = (offset) => page.evaluate((step) => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + step);
    const pad = (value) => String(value).padStart(2, "0");
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
  }, offset);

  const removeProbeData = async () => {
    const items = await api("GET", "/api/items");
    for (const row of (Array.isArray(items.body) ? items.body : []).filter((entry) => entry.name.startsWith("窗口探针·"))) {
      await api("DELETE", `/api/items/${row.id}`);
      await api("DELETE", `/api/items/${row.id}`, { permanent: true });
    }
    const locations = await api("GET", "/api/dashboard");
    for (const row of (locations.body?.locations ?? []).filter((entry) => entry.name === PROBE_SPACE)) {
      await api("DELETE", `/api/locations/${row.id}`);
    }
  };

  const original = (await api("GET", "/api/settings/preferences")).body ?? {};
  await removeProbeData();

  const space = await api("POST", "/api/locations", { name: PROBE_SPACE, icon: "Package", color: "#0ea5e9" });
  const spaceId = space.body?.id;
  check(
    "探针空间已建好(否则下面两条卡片断言是空跑)",
    Boolean(spaceId),
    `status=${space.status} body=${JSON.stringify(space.body).slice(0, 160)}`,
  );
  const offsets = [-1, 3, 8, 20, 40];
  let itemsCreated = 0;
  for (const offset of offsets) {
    const created = await api("POST", "/api/items", {
      name: `窗口探针·T${offset >= 0 ? "+" : ""}${offset}`, type: "CONSUMABLE", unit: "盒", category: "食品",
      quantity: 2, minQuantity: 0, remainingPercent: 100, expiryDate: await localDay(offset), locationId: spaceId, price: 3,
    });
    if (created.status === 200 || created.status === 201) itemsCreated += 1;
  }
  check("五件探针物品都建好了", itemsCreated === offsets.length, `成功 ${itemsCreated}/${offsets.length}`);

  const setWindow = async (windowDays) => {
    const written = await api("PATCH", "/api/settings/preferences", { ...original, expiryReminderDays: windowDays });
    const readBack = await api("GET", "/api/settings/preferences");
    return { status: written.status, effective: readBack.body?.expiryReminderDays ?? null };
  };

  const measured = {};
  for (const windowDays of [7, 30]) {
    const applied = await setWindow(windowDays);
    check(
      `「保质期提前」能改成 ${windowDays} 天(后面两条断言才不是空跑)`,
      applied.effective === windowDays,
      `PATCH status=${applied.status} 写回后读到=${applied.effective}`,
    );
    const state = await expiryState();
    const expectedSoon = state.all.filter((row) => row.days >= 0 && row.days <= windowDays).length;
    measured[windowDays] = {
      expectedMonthly: state.all.filter((row) => row.days <= windowDays).length,
      expectedExpired: state.totals.expired,
      expectedSoon,
      expectedSoonInSpace: state.all.filter((row) => row.locationId === spaceId && row.days >= 0 && row.days <= windowDays).length,
      expectedExpiredInSpace: state.all.filter((row) => row.locationId === spaceId && row.days < 0).length,
    };

    // 月报:标题会写「要到期了(共 N 件…)」;没截断时列表长度就是总数
    await page.goto(`${BASE}/report`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const report = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const matched = /要到期了\(共\s*(\d+)\s*件/.exec(text);
      const section = text.slice(text.indexOf("要到期了")).split("快用完了")[0];
      // 列表每行的形状是「名字 · 今天到期 / N 天后到期 / 已过期 N 天」
      const listed = (section.match(/·\s*(?:已过期\s*\d+\s*天|今天到期|明天到期|\d+\s*天后到期)/g) ?? []).length;
      return { total: matched ? Number(matched[1]) : null, listed };
    });
    const shown = report.total ?? report.listed;
    check(
      `月报的到期窗口跟用户设置走(${windowDays} 天)`,
      shown === measured[windowDays].expectedMonthly,
      `月报=${shown}(总数或列表条数) 按 ${windowDays} 天手算=${measured[windowDays].expectedMonthly}`,
    );

    // 空间卡:临期与已过期分开说,窗口也跟设置走
    await page.goto(`${BASE}/locations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const card = await page.evaluate((name) => {
      const nodes = [...document.querySelectorAll("button")].filter((entry) => (entry.innerText || "").includes(name));
      // 同一个名字会匹配到多个元素(空间筛选胶囊等);真正的卡片是带「N 件 · …」摘要的那个
      const target = nodes.find((entry) => /件\s*·/.test(entry.innerText || "")) ?? nodes[nodes.length - 1];
      return target ? (target.innerText || "").replace(/\n+/g, " ") : "";
    }, PROBE_SPACE);
    const soonOnCard = Number((/·\s*(\d+)\s*件临期/.exec(card) ?? [])[1] ?? NaN);
    const expiredOnCard = Number((/·\s*(\d+)\s*件已过期/.exec(card) ?? [])[1] ?? NaN);
    check(
      `空间卡的「N 件临期」按用户窗口数,不含已过期(${windowDays} 天)`,
      soonOnCard === measured[windowDays].expectedSoonInSpace,
      `卡片=${Number.isNaN(soonOnCard) ? "(没有这一项)" : soonOnCard} 手算=${measured[windowDays].expectedSoonInSpace} 卡片原文=${card}`,
    );
    check(
      `空间卡把已过期单独说(${windowDays} 天)`,
      expiredOnCard === measured[windowDays].expectedExpiredInSpace,
      `卡片=${Number.isNaN(expiredOnCard) ? "(没有这一项)" : expiredOnCard} 手算=${measured[windowDays].expectedExpiredInSpace}`,
    );
  }

  check(
    "换了窗口之后月报的数字确实跟着变(不是量到同一堆数据)",
    measured[7].expectedMonthly !== measured[30].expectedMonthly,
    `7 天=${measured[7].expectedMonthly} 30 天=${measured[30].expectedMonthly}`,
  );

  // 还原:偏好与探针数据都还回去
  await setWindow(original.expiryReminderDays ?? 7);
  await removeProbeData();
  const leftover = await api("GET", "/api/items");
  const remaining = (Array.isArray(leftover.body) ? leftover.body : []).filter((entry) => entry.name.startsWith("窗口探针·")).length;
  check("探针数据已清理干净", remaining === 0, `还剩 ${remaining} 件`);
}

// ---------- 用完的消耗品:月报与概览必须都列出来 ----------
// 项目自己的口径(CHANGELOG v0.1.94):「用完的物品会出现在月报的『快用完了』里(正是该补货的
// 东西),而不是凭空消失」。实测(2026-11-27)月报列 5 件、概览只列 4 件 —— 概览那份清单被
// 物品列表的 `quantity > 0` 过滤顺手带走了,于是「已经用完了」这一行在概览上永远不出现。
// 数据来自 seed-ci-fixtures 里的两件:一件用完的(要出现)、一件暂停补货的(不该出现)。
const USED_UP = "界面检查·已经用完的挂面";
const PAUSED = "界面检查·暂停补货的牙膏";

const readForecastList = async (url, opener) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  if (opener) {
    await page.evaluate((label) => {
      const details = [...document.querySelectorAll("details")].find((el) => (el.innerText || "").includes(label));
      if (details && !details.open) details.querySelector("summary")?.click();
    }, opener);
    await page.waitForTimeout(900);
  }
  return page.evaluate(() => {
    const section = [...document.querySelectorAll("section")].find((el) => /快用完了/.test(el.innerText || ""));
    return section ? (section.innerText || "").replace(/\s+/g, " ").trim() : "";
  });
};

const reportList = await readForecastList(`${BASE}/report`);
const dashboardList = await readForecastList(`${BASE}/`, "更多待处理事项");
check("月报的「快用完了」有内容(否则下面两条是空跑)", reportList.length > 0, `月报小节=${reportList.slice(0, 60) || "(空)"}`);
check("概览的「快用完了」有内容(否则下面两条是空跑)", dashboardList.length > 0, `概览小节=${dashboardList.slice(0, 60) || "(空)"}`);
check("用完的消耗品在月报的「快用完了」里(正是该补货的那件)", reportList.includes(USED_UP), `月报=${reportList.slice(0, 160)}`);
check("用完的消耗品在概览的「快用完了」里(不能只在月报出现)", dashboardList.includes(USED_UP), `概览=${dashboardList.slice(0, 160)}`);
check("暂停补货的物品不进月报的「快用完了」", !reportList.includes(PAUSED), `月报=${reportList.slice(0, 160)}`);
check("暂停补货的物品不进概览的「快用完了」", !dashboardList.includes(PAUSED), `概览=${dashboardList.slice(0, 160)}`);

// ---------- 冰箱清单:月报与概览必须是同一份名单 ----------
// 实测(2026-11-27)两处口径不同:
//   · 月报会念一件「已经喝完的鲜奶」还没放好 —— 一件吃完的东西没法再放回冰箱;
//   · 概览的「该冷藏 N 件」把「开封后冷藏」的算进去了,却从来没渲染过它们(实测 4 件 vs 3 行)。
const readFridgeSection = async (url, opener, pattern) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  if (opener) {
    await page.evaluate((label) => {
      const details = [...document.querySelectorAll("details")].find((el) => (el.innerText || "").includes(label));
      if (details && !details.open) details.querySelector("summary")?.click();
    }, opener);
    await page.waitForTimeout(900);
  }
  return page.evaluate((source) => {
    const section = [...document.querySelectorAll("section")].find((el) => new RegExp(source).test(el.innerText || ""));
    return section ? (section.innerText || "").replace(/\s+/g, " ").trim() : "";
  }, pattern);
};

const USED_UP_COLD = "界面检查·已经喝完的鲜奶";
const AFTER_OPEN = "界面检查·开封后冷藏的果酱";
const reportFridge = await readFridgeSection(`${BASE}/report`, null, "该放冰箱的|该冷藏的都放好了");
const dashboardFridge = await readFridgeSection(`${BASE}/`, "更多待处理事项", "冰箱清单");
check("月报的冰箱小节读到了(否则下面两条是空跑)", reportFridge.length > 0, `月报=${reportFridge.slice(0, 80) || "(空)"}`);
check("概览的冰箱小节读到了(否则下面两条是空跑)", dashboardFridge.length > 0, `概览=${dashboardFridge.slice(0, 80) || "(空)"}`);
check("已经喝完的冷藏品不再被念「还没放好」", !reportFridge.includes(USED_UP_COLD), `月报=${reportFridge.slice(0, 160)}`);
check("开封后冷藏的那件在概览的冰箱清单里出现(它曾被算进件数却从不显示)", dashboardFridge.includes(AFTER_OPEN), `概览=${dashboardFridge.slice(0, 160)}`);
const missingNames = [...reportFridge.matchAll(/界面检查·[^\s·]+/g)].map((match) => match[0]).filter((name) => !dashboardFridge.includes(name));
check("月报列的每一件「还没放好」在概览的冰箱清单里都找得到", missingNames.length === 0, `概览缺:${missingNames.join(" / ")}`);

// 外部字体/CDN 拉取失败不算应用错误:字体是第三方 OSS 托管,
// 网络受限或离线时必然失败,但界面已用 font-display: swap 回退到系统字体,功能不受影响。
const externalResourceFailure = (text) => text.includes("Failed to load resource") || /font at|ERR_(FAILED|CONNECTION|BLOCKED)/.test(text);
const relevant = consoleErrors.filter((text) => !text.includes("favicon") && !externalResourceFailure(text));
check("月报页没有控制台错误", relevant.length === 0, relevant.slice(0, 2).join(" | "));

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
}
process.exit(failed.length ? 1 : 0);
