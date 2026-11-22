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
