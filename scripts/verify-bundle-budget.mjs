// 传输体积预算:首屏 JS/CSS 的体积不该悄悄膨胀。
//
// 与「耗时」类检查不同,体积是**确定性**的:同一份构建在任何机器上都一样,
// 所以它可以稳定进 CI —— 用来拦住「不小心把重库(sharp/图表库之类)打进了客户端」。
//
// 做法:用 CDP 统计每个路由首次加载时各类资源的传输字节(压缩后),
// 与预算比较;同时报告最大的单个 JS 分块,便于定位。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-bundle-budget.mjs

import { launchChromium } from "./lib/browser.mjs";
import { loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

// 预算(传输字节,压缩后)。基线实测后取约 15% 余量。
// 基线(实测):JS 约 289KB、CSS 约 14KB、最大分块 101KB、请求 20~63 个。
// 预算留约 30~50% 余量:目的是拦住「不小心把重库打进客户端」这类数量级膨胀,
// 而不是卡住每一次正常增长。
const BUDGET = {
  js: 420 * 1024,
  css: 40 * 1024,
  total: 700 * 1024,
  requests: 85,
  largestChunk: 160 * 1024,
};

const ROUTES = ["/", "/items", "/settings", "/audit", "/report"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};
const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;

const browser = await launchChromium();
// 关掉 Service Worker:否则二次访问会命中缓存,体积统计失真
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  process.exit(1);
}

const client = await context.newCDPSession(page);
await client.send("Network.enable");

let collecting = false;
let current = null;

client.on("Network.responseReceived", (event) => {
  if (!collecting) return;
  current.pending[event.requestId] = { type: event.type, url: event.response.url };
});
client.on("Network.loadingFinished", (event) => {
  if (!collecting) return;
  const info = current.pending[event.requestId];
  if (!info) return;
  delete current.pending[event.requestId];
  const bytes = event.encodedDataLength || 0;
  current.total += bytes;
  current.requests += 1;
  if (info.type === "Script") {
    current.js += bytes;
    if (bytes > current.largest) current.largest = bytes;
  } else if (info.type === "Stylesheet") {
    current.css += bytes;
  }
});

for (const route of ROUTES) {
  // 先访问一次让应用完成初始化(欢迎引导、会话校验),再重新统计首屏
  await page.goto(BASE + route);
  await page.waitForTimeout(1500);

  current = { js: 0, css: 0, total: 0, requests: 0, largest: 0, pending: {} };
  collecting = true;
  await client.send("Network.clearBrowserCache");
  await page.goto(BASE + route, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  collecting = false;

  const stats = current;
  console.log(
    `      ${route.padEnd(10)} JS ${kb(stats.js).padStart(7)}  CSS ${kb(stats.css).padStart(6)}  总计 ${kb(stats.total).padStart(7)}  请求 ${String(stats.requests).padStart(3)}  最大分块 ${kb(stats.largest)}`,
  );

  if (stats.total === 0) {
    check(`${route}:统计到了资源(防止空跑)`, false, "没有记录到任何网络请求");
    continue;
  }

  check(`${route}:首屏 JS ≤ ${kb(BUDGET.js)}`, stats.js <= BUDGET.js, `实测 ${kb(stats.js)}`);
  check(`${route}:首屏样式 ≤ ${kb(BUDGET.css)}`, stats.css <= BUDGET.css, `实测 ${kb(stats.css)}`);
  check(`${route}:单个 JS 分块 ≤ ${kb(BUDGET.largestChunk)}`, stats.largest <= BUDGET.largestChunk, `最大 ${kb(stats.largest)}`);
  check(`${route}:请求数 ≤ ${BUDGET.requests}`, stats.requests <= BUDGET.requests, `实测 ${stats.requests}`);
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);