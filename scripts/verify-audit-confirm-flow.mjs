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

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);