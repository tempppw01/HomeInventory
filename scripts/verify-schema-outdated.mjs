// 「库结构比应用旧」时的失败体验 —— 自建部署最常见的一种升级失误。
//
// 场景:把镜像换成新版本,却忘了同步数据库结构(本项目用 prisma db push,启动时不会自动迁移)。
// 实测(修之前)用户看到的是:
//   · 所有业务接口 500「服务器暂时开小差了,请稍后重试」—— 听起来像临时故障,会一直刷新重试;
//   · 页面直接崩成通用错误页「页面没能加载出来 / 可以重试一次」;
//   · /api/health 还是 200 {"status":"ok"} —— 监控说一切正常。
//
// 修完之后这里逐条钉住:
//   1 健康检查如实报 degraded / schema-outdated,并给出可照做的命令;
//   2 业务接口回 503 + code=SCHEMA_OUTDATED + 说明(不再是「稍后重试」);
//   3 页面显示「没能读到家里的数据」+ 那条说明 + 重新加载,**不**再崩成通用错误页;
//   4 正常库完全不受影响(否则这一套可能只是「到处都报错」而不是「认出来了」)。
//
// 两个实例必须**各自登录**:会话是各实例自己的密钥签的,借另一个实例的 cookie 会 401(实测)。
// 页面内 fetch 也只在同源可用 —— 跨端口会被 CORS 拦掉,所以每个源各开一页。
//
// 需要一个「模拟老库」的实例(CI 里是 3004:由 ci.db 复制后删掉两列)。
// 用法:BASE_URL=http://127.0.0.1:3001 BASE_OLD_URL=http://127.0.0.1:3004 PROBE_USER=... node scripts/verify-schema-outdated.mjs

import { launchChromium } from "./lib/browser.mjs";

const HEALTHY = process.env.BASE_URL || "http://127.0.0.1:3001";
const OLD = process.env.BASE_OLD_URL || "http://127.0.0.1:3004";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const getJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: response.status, json };
};

// ---------- 1 健康检查要如实 ----------
const oldHealth = await getJson(`${OLD}/api/health`);
check("老库的健康检查不再是「一切正常」", oldHealth.status === 503, `status=${oldHealth.status} body=${JSON.stringify(oldHealth.json).slice(0, 120)}`);
check("老库健康检查明确说是「结构过期」", oldHealth.json?.database === "schema-outdated" && oldHealth.json?.status === "degraded", JSON.stringify(oldHealth.json).slice(0, 160));
check("健康检查里带上了可照做的命令", /db:push/.test(String(oldHealth.json?.hint ?? "")), `hint=${oldHealth.json?.hint ?? "(无)"}`);

const healthyHealth = await getJson(`${HEALTHY}/api/health`);
check("正常库仍然报 ok(说明这一套不是「到处都报错」)", healthyHealth.status === 200 && healthyHealth.json?.status === "ok", `status=${healthyHealth.status} body=${JSON.stringify(healthyHealth.json).slice(0, 120)}`);

const browser = await launchChromium();

/** 在指定源里登录,并返回这一页(同源 fetch 才能用) */
const loggedInPage = async (origin) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const status = await page.evaluate(async (creds) => {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds) });
    return response.status;
  }, { username: USER, password: PASS });
  return { context, page, loginStatus: status };
};

// ---------- 2 老库:业务接口 ----------
const oldSession = await loggedInPage(OLD);
check("能在老库上登录(账号表是好的)", oldSession.loginStatus === 200, `POST /api/auth/login → ${oldSession.loginStatus}`);

const oldItems = await oldSession.page.evaluate(async () => {
  const response = await fetch("/api/items", { cache: "no-store" });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
});
check("老库的业务接口回 503(不再是 500「稍后重试」)", oldItems.status === 503, `status=${oldItems.status} body=${JSON.stringify(oldItems.json).slice(0, 120)}`);
check("响应里带 SCHEMA_OUTDATED 标记,便于界面识别", oldItems.json?.code === "SCHEMA_OUTDATED", JSON.stringify(oldItems.json).slice(0, 140));
check("说明是可照做的:给出命令、Docker 提示与下一步", /db:push/.test(String(oldItems.json?.error ?? "")) && /Docker/.test(String(oldItems.json?.error ?? "")) && /刷新/.test(String(oldItems.json?.error ?? "")), String(oldItems.json?.error ?? "(无)").slice(0, 160));

// ---------- 3 老库:页面 ----------
await oldSession.page.goto(`${OLD}/items`, { waitUntil: "domcontentloaded" });
await oldSession.page.waitForTimeout(3200);
const pageState = await oldSession.page.evaluate(() => {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  return {
    loadFailed: Boolean(document.querySelector("[data-load-failed]")),
    genericCrash: /页面没能加载出来/.test(text),
    hasHint: /db:push/.test(text),
    hasRetry: /重新加载/.test(text),
    snippet: text.slice(0, 200),
  };
});
check("页面显示的是「没能读到家里的数据」失败态", pageState.loadFailed, pageState.snippet);
check("页面**不再**崩成通用错误页(「页面没能加载出来」)", !pageState.genericCrash, pageState.snippet);
check("页面上就能看到那条命令", pageState.hasHint, pageState.snippet);
check("失败态提供重新加载入口", pageState.hasRetry, pageState.snippet);

// ---------- 4 正常库不受影响 ----------
const healthySession = await loggedInPage(HEALTHY);
await healthySession.page.goto(`${HEALTHY}/items`, { waitUntil: "domcontentloaded" });
await healthySession.page.waitForTimeout(3000);
const healthyPage = await healthySession.page.evaluate(() => {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  return {
    loadFailed: Boolean(document.querySelector("[data-load-failed]")),
    genericCrash: /页面没能加载出来/.test(text),
    hasItemsHeading: /物品与采购/.test(text),
  };
});
check("正常库的页面正常渲染(没有误进失败态)", !healthyPage.loadFailed && !healthyPage.genericCrash && healthyPage.hasItemsHeading, JSON.stringify(healthyPage));

await oldSession.context.close();
await healthySession.context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);