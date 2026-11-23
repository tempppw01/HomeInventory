// 体系化无障碍扫描:axe-core 跑全部页面 × 亮/暗主题 × 桌面/窄屏,断言零违规。
//
// 为什么要加这一层:项目原本已有四套手写无障碍检查(键盘 14 项、弹窗 71 项、菜单 13 项、
// 对比度 15 项),但它们都是「我想到哪儿就查哪儿」。第一次跑 axe 就抓到四类此前没发现的问题:
//   · label-content-name-mismatch(9 个页面)—— 按钮的 aria-label 把可见文字**覆盖**掉了,
//     语音控制用户念屏幕上的字匹配不上(WCAG 2.5.3);
//   · button-name(critical,只在 390px 出现)—— 「完成」「安排任务」「添加空间」这些按钮
//     在窄屏只留图标,而它们的文字是 hidden 的,读屏听到的是一串没有名字的「按钮」;
//   · color-contrast —— 状态胶囊的文字压在 14~16% 混色底上只有 4.4:1;
//   · region —— 扫码消耗页的返回链接挂在 main 外面。
// 手写检查里「图标按钮都有可访问名」用的是 textContent,而 hidden 的文字仍在 textContent 里 ——
// 这正是它漏掉 390px 那 10 个按钮的原因;axe 看的是**渲染后**的文字。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-axe.mjs
// axe-core 固定在 devDependencies 里(不挂 CDN):CI 无外网也要能跑,规则集不随版本漂。

import { readFileSync } from "node:fs";
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

const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ---------- 登录 ----------
// 不用 lib/probe-auth 的 loginAndConfirm:应用启动时会先显示「正在检查账号状态...」,
// 那时登录表单还没进 DOM,只等 1.8 秒会把「还在加载」当成「已登录」。
const waitForSurface = async (timeout = 25000) => {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      login: Boolean(document.querySelector("#auth-username")),
      shell: (document.querySelector("main")?.innerText || "").trim().length > 10,
    }));
    if (last.login || last.shell) return last;
    await page.waitForTimeout(400);
  }
  return last ?? { login: false, shell: false };
};

await page.goto(BASE);
let surface = await waitForSurface();
if (surface.login) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.fill("#auth-username", USER);
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2600);
    surface = await waitForSurface(15000);
    if (!surface.login && surface.shell) break;
    if (await page.evaluate(() => /频繁|稍后再试|too many/i.test(document.body.innerText || ""))) {
      console.log("      登录被限速,等 20 秒重试");
      await page.waitForTimeout(20000);
    }
  }
}
check("已登录(否则扫的是登录页)", !surface.login && surface.shell, "仍停在登录页");
if (surface.login || !surface.shell) {
  await context.close();
  await browser.close();
  process.exit(1);
}
await dismissBlockingDialogs(page);

// ---------- 页面清单(详情 / 扫码页要真实 id) ----------
const ids = await page.evaluate(async () => {
  try {
    const response = await fetch("/api/items", { cache: "no-store" });
    const body = await response.json();
    const rows = Array.isArray(body) ? body : (body.items ?? []);
    return { itemId: rows[0]?.id ?? null, itemCode: rows[0]?.itemCode ?? null };
  } catch {
    return { itemId: null, itemCode: null };
  }
});
const routes = [
  "/", "/items", "/locations", "/tasks", "/audit", "/settings", "/about", "/report", "/offline",
  ids.itemId ? `/items/${ids.itemId}` : null,
  ids.itemCode ? `/consume/${ids.itemCode}` : null,
].filter(Boolean);

const combos = [
  { theme: "light", width: 1440, height: 900 },
  { theme: "dark", width: 1440, height: 900 },
  // 窄屏单独跑一遍:10 个「只在 390px 没有名字」的按钮就是这么抓到的。
  { theme: "light", width: 390, height: 844 },
];

const violations = new Map();
let scanned = 0;

for (const combo of combos) {
  await page.setViewportSize({ width: combo.width, height: combo.height });
  await page.evaluate((theme) => { localStorage.setItem("home-inventory-theme", theme); }, combo.theme);
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2300);
    await page.evaluate(axeSource);
    const found = await page.evaluate(async () => {
      const report = await window.axe.run(document);
      return {
        counts: { violations: report.violations.length, passes: report.passes.length },
        list: report.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
          sample: (violation.nodes[0]?.html || "").replace(/\s+/g, " ").slice(0, 120),
        })),
      };
    });
    // axe 至少会跑出若干条 passes;passes 为 0 说明根本没扫到东西(空页面/登录页)。
    if (found.counts.passes === 0) {
      check(`${combo.theme}@${combo.width} ${route}:axe 真的扫到了内容`, false, `passes=0`);
      continue;
    }
    scanned += 1;
    for (const violation of found.list) {
      const key = violation.id;
      if (!violations.has(key)) violations.set(key, { ...violation, where: [] });
      violations.get(key).where.push(`${combo.theme}@${combo.width} ${route}(${violation.nodes})`);
    }
  }
}
await page.evaluate(() => { localStorage.setItem("home-inventory-theme", "system"); });

check(`扫到了足够多的页面组合(防止空跑)`, scanned >= routes.length * combos.length - 2, `实际扫描 ${scanned} 次`);
check("没有任何 axe 违规", violations.size === 0, [...violations.values()].map((v) => `${v.id}×${v.where.length} ${v.where.slice(0, 3).join("/")} :: ${v.sample}`).join(" | ").slice(0, 600));

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n扫了 ${routes.length} 个页面 × ${combos.length} 种视口/主题 = ${scanned} 次`);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
}
process.exit(failed.length ? 1 : 0);