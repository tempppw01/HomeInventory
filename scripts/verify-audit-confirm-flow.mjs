// 盘点流程的验收(从 4 条扩到 9 条)。
//
// 此前只验了「确认第一件后进度 +1」。而这条流程真正的风险在后面:
//   · 刷新后进度还在不在(进度存在 localStorage);
//   · 结束盘点的数字与记录是否对得上;
//   · **结束盘点写服务端失败时会不会说**(实测:拦掉 /api/audits 的 POST,界面一声不响,
//     记录只留在本机 localStorage —— 换设备就没了);
//   · 「重新开始」会不会把旧进度清掉(它会弹确认框,不点就等于没清 —— 我上一版探针就误判过)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-audit-confirm-flow.mjs

import { launchChromium } from "./lib/browser.mjs";
import { loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录", auth.ok, auth.detail);

const clearDialogs = async () => {
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('[role="dialog"]:visible').count()) === 0) return;
    const skip = page.locator('[aria-label="暂时跳过欢迎引导"]:visible').first();
    if (await skip.count()) await skip.click().catch(() => {});
    else await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }
};

const openAudit = async () => {
  await page.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await clearDialogs();
};

/** 「进度 X / Y」—— 注意别用 /(\d+)\/(\d+)/,那会先撞上「最近盘点 · 4/4 件」(上一版就错在这里) */
const readProgress = () => page.evaluate(() => {
  const text = (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ");
  const match = /进度\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  return match ? { done: Number(match[1]), total: Number(match[2]) } : null;
});

const confirmSome = async (count) => {
  const rows = page.locator("main button").filter({ hasText: /INV-|·/ });
  const available = await rows.count();
  for (let i = 0; i < Math.min(count, available); i += 1) {
    await rows.nth(i).click().catch(() => {});
    await page.waitForTimeout(700);
  }
  return available;
};

const clickFinish = async () => {
  const finish = page.locator("main button").filter({ hasText: /结束盘点|完成盘点/ }).first();
  const exists = (await finish.count()) > 0;
  if (exists) { await finish.click().catch(() => {}); await page.waitForTimeout(2200); }
  return exists;
};

// ---------- 1 进度可识别 ----------
await openAudit();
const start = await readProgress();
check("盘点页有可识别的进度(「进度 X / Y」)", start !== null, `读到=${JSON.stringify(start)}`);

// ---------- 2 确认推进 + 刷新后保留 ----------
await confirmSome(2);
const afterConfirm = await readProgress();
check("确认后进度推进", Boolean(start && afterConfirm) && afterConfirm.done > start.done, `${JSON.stringify(start)} → ${JSON.stringify(afterConfirm)}`);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
const afterReload = await readProgress();
check("刷新后进度保留(它存在 localStorage)", JSON.stringify(afterReload) === JSON.stringify(afterConfirm), `${JSON.stringify(afterConfirm)} → ${JSON.stringify(afterReload)}`);

// ---------- 3 结束盘点:数字一致 + 服务端记录一致 ----------
const finishedOk = await clickFinish();
check("有「结束盘点」入口", finishedOk, "没找到结束按钮");
const finishedText = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));
const finishedNumbers = /已确认\s*(\d+)\s*\/\s*(\d+)\s*件/.exec(finishedText);
check(
  "结束页显示了「已确认 X / Y」且与进度一致",
  Boolean(finishedNumbers) && afterReload !== null && Number(finishedNumbers[1]) === afterReload.done && Number(finishedNumbers[2]) === afterReload.total,
  `结束页=${finishedNumbers ? `${finishedNumbers[1]}/${finishedNumbers[2]}` : "(没读到)"} 进度=${JSON.stringify(afterReload)}`,
);

const audits = await page.evaluate(async () => {
  const response = await fetch("/api/audits", { cache: "no-store" });
  return { status: response.status, json: await response.json().catch(() => null) };
});
const latest = Array.isArray(audits.json?.audits) ? audits.json.audits[0] : null;
check("服务端记录了本次盘点", audits.status === 200 && Boolean(latest), `status=${audits.status}`);
check(
  "服务端记录的 total/confirmed 与界面一致",
  Boolean(latest) && Boolean(afterReload) && Number(latest.total) === afterReload.total && Number(latest.confirmed) === afterReload.done,
  `记录=${JSON.stringify(latest)} 界面=${JSON.stringify(afterReload)}`,
);

// ---------- 3.5 服务端对盘点数字的边界处理 ----------
// 由来(实测):`total: 1000000000` 会被原样写进盘点历史 —— 一条这样的记录会让"最近盘了多少"彻底失真,
// 而且只留 20 条,它会顶掉一条真实记录。取整 / 确认数不超过总数 / 空间名截断这几条已经实现,一并钉住。
{
  const post = async (body) => page.evaluate(async (payload) => {
    const response = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
    return { status: response.status, json: await response.json().catch(() => null) };
  }, body);

  const absurd = await post({ total: 1000000000, confirmed: 1000000000 });
  check("荒唐的盘点数量(10 亿)被拒,不会写进历史", absurd.status === 400 && /合理范围/.test(String(absurd.json?.error ?? "")), `status=${absurd.status} ${JSON.stringify(absurd.json?.error ?? "").slice(0, 80)}`);

  const overConfirm = await post({ total: 5, confirmed: 9 });
  check("确认数超过总数会被夹到总数", overConfirm.status === 201 && Number(overConfirm.json?.confirmed) === 5, JSON.stringify(overConfirm.json).slice(0, 90));

  const rounded = await post({ total: 3.7, confirmed: 2.4 });
  check("小数会被取整", rounded.status === 201 && Number(rounded.json?.total) === 4 && Number(rounded.json?.confirmed) === 2, JSON.stringify(rounded.json).slice(0, 90));

  const longName = await post({ total: 1, confirmed: 1, locationName: "厨".repeat(200) });
  check("超长空间名会被截到 60 字", longName.status === 201 && String(longName.json?.locationName ?? "").length === 60, `长度=${String(longName.json?.locationName ?? "").length}`);

  const negative = await post({ total: -3, confirmed: 1 });
  check("负数被拒", negative.status === 400, `status=${negative.status}`);

  // 复查历史:里面不该留下任何不合理的记录(包括刚才那几条合法测试记录的数字关系)
  const again = await page.evaluate(async () => {
    const response = await fetch("/api/audits", { cache: "no-store" });
    return { status: response.status, json: await response.json().catch(() => null) };
  });
  const rows = Array.isArray(again.json?.audits) ? again.json.audits : [];
  const impossible = rows.filter((row) => Number(row.confirmed) > Number(row.total) || Number(row.total) < 0 || Number(row.total) > 1000000 || !Number.isInteger(Number(row.total)));
  check("盘点历史里没有不合理记录(确认数≤总数、总数在合理范围)", impossible.length === 0, JSON.stringify(impossible).slice(0, 160));
  check("盘点历史最多保留 20 条", rows.length <= 20, `实际 ${rows.length} 条`);
}

// ---------- 4 服务端写入失败时必须说出来 ----------
{
  await openAudit();
  await confirmSome(1);
  const beforeFail = await readProgress();
  await page.route("**/api/audits", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await clickFinish();
  const failureState = await page.evaluate(() => {
    const text = (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ");
    const toast = [...document.querySelectorAll('[role="status"], [data-toast]')].map((node) => (node.textContent || "").trim()).join(" | ");
    return { text, toast };
  });
  const admitted = /只在本机|没同步|同步到服务端失败|没存/.test(failureState.text) || /只在本机|没同步|同步到服务端失败|没存/.test(failureState.toast);
  check("服务端写入失败时明确说出来(而不是假装成功)", admitted, `进度=${JSON.stringify(beforeFail)} 页面/提示=${(failureState.text + " | " + failureState.toast).slice(0, 160)}`);
  await page.unroute("**/api/audits");
}

// ---------- 5 「重新开始」清零进度(要点掉确认框) ----------
{
  await page.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await clearDialogs();
  await confirmSome(2);
  const withProgress = await readProgress();
  const restart = page.locator("main button").filter({ hasText: /重新开始/ }).first();
  const hasRestart = (await restart.count()) > 0;
  check("有「重新开始」入口", hasRestart, "没找到");
  if (hasRestart) {
    await restart.click().catch(() => {});
    await page.waitForTimeout(900);
    const confirmButton = page.locator('[role="dialog"]:visible button').filter({ hasText: /重新开始|确定|确认/ }).last();
    const asked = (await confirmButton.count()) > 0;
    check("重新开始前会先问一句", asked, "没弹确认框");
    if (asked) await confirmButton.click().catch(() => {});
    await page.waitForTimeout(1600);
    const afterRestart = await readProgress();
    check("确认「重新开始」后进度清零", Boolean(afterRestart) && afterRestart.done === 0, `${JSON.stringify(withProgress)} → ${JSON.stringify(afterRestart)}`);
  }
}

// ---------- 6 本机留下的盘点历史,必须与服务端记录分得清 ----------
// 由来(2026-11-28 实测):同一个账号、同一个服务端(0 条盘点记录),两个浏览器上下文给出两种答案 ——
// 有本机历史的那个显示「最近盘点:11/20 · 1/9 件」还画了趋势图,干净的那个显示
// 「第一次盘点?先扫一个二维码试试」。两边都像在陈述事实,谁也没说自己的历史是从哪来的。
//
// 这里用路由拦截构造三种情形,不改真实数据:
//   · 服务端 0 条 + 本机有历史   → 必须写明「只在本机」「服务器上没有」
//   · 服务端有记录               → 照旧是「最近盘点」,不许挂那句提示(不能过度声明)
//   · 这次没读到(离线)          → 也要说明没跟服务端核对过
{
  const localEntry = { at: new Date().toISOString(), total: 9, confirmed: 1, locationName: "全部空间" };
  // 复用已登录的会话 cookie 开隔离上下文:**只要** localStorage 是干净的。
  // 不重新登录:登录接口限速 12 次/分钟/IP,这一套里再登录 3 次很容易撞上(其它套件也在跑)。
  const sessionCookies = await context.cookies();
  /** mode: "empty" | "server" | "unreadable" —— 在隔离上下文里跑,不碰本套件当前页面的状态 */
  const auditPageText = async (mode) => {
    // `serviceWorkers: "block"` 是必须的:Service Worker 自己发的请求**不经过** Playwright 的路由拦截
    // (第一版没写这条,route.fulfill/abort 全都没生效,三次断言红得毫无意义 —— 它其实一直在读真实响应)。
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addCookies(sessionCookies);
    const probe = await ctx.newPage();
    await probe.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
    await probe.waitForTimeout(1200);
    // 装上一份「本机历史」—— 模拟「这台设备以前盘点过,而服务端那份已经不在」
    await probe.evaluate((entry) => {
      localStorage.setItem("home-inventory-audit-history-v1", JSON.stringify([entry]));
      localStorage.setItem("home-inventory-audit-confirmed-v1", "[]");
    }, localEntry);
    await probe.route("**/api/audits", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (mode === "empty") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ audits: [] }) });
      if (mode === "unreadable") return route.abort();
      return route.continue();
    });
    await probe.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
    await probe.waitForTimeout(3000);
    const text = await probe.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));
    await ctx.close();
    return text;
  };

  const onlyOnDevice = "只在这台设备的浏览器里";
  const emptyText = await auditPageText("empty");
  check(
    "服务端没有记录、本机还留着旧历史时,不把它当成「最近盘点」直说",
    emptyText.includes("本机记录的最近一次盘点") && !/最近盘点:/.test(emptyText),
    emptyText.slice(0, 200),
  );
  check(
    "并说清它在服务器上没有对应记录(换台设备看不到)",
    emptyText.includes(onlyOnDevice) && emptyText.includes("服务器上没有对应的盘点记录"),
    emptyText.slice(0, 260),
  );

  const serverText = await auditPageText("server");
  check(
    "服务端有记录时照旧是「最近盘点」,不挂那句「只在本机」(不能过度声明)",
    /最近盘点:/.test(serverText) && !serverText.includes(onlyOnDevice),
    serverText.slice(0, 200),
  );

  const offlineText = await auditPageText("unreadable");
  check(
    "这次没从服务器读到本机历史时,也说明它没跟服务端核对过",
    offlineText.includes(onlyOnDevice) && offlineText.includes("这次没从服务器读到"),
    offlineText.slice(0, 260),
  );
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);