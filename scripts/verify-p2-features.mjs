// 验证 P2 新增功能:详情页变更记录、CSV 导出、批量改数量、到期日历、SW 注册。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const EXECUTABLE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`); };

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#auth-username", { timeout: 25000 });
await page.fill("#auth-username", process.env.PROBE_USER || "bgs");
await page.fill("#auth-password", process.env.PROBE_PASS || "");
await page.click('button[type="submit"]');
await page.waitForFunction(() => Boolean(document.querySelector('[aria-label="概览"]')), null, { timeout: 25000 });
await page.waitForTimeout(900);
const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400); }

// 造两件带到期日的物品
const ids = await page.evaluate(async () => {
  const base = { quantity: 3, category: "食品", type: "CONSUMABLE", minQuantity: 1, remainingPercent: 80, unit: "盒", price: 19.9, purchaseDate: "2026-11-01", locationId: null, notes: "p2 验证用", imageUrl: null, recordPurchase: false, purchaseStore: null };
  const created = [];
  for (const [name, expiryDate] of [["P2-酸奶", "2026-11-20"], ["P2-牛奶", "2026-12-05"]]) {
    const response = await fetch("/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, name, expiryDate }) });
    const json = await response.json();
    if (json.id) created.push(json.id);
  }
  return created;
});
record("准备:创建 2 件带到期日的物品", ids.length === 2, `ids=${ids.length}`);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

// 1) 到期日历
{
  const details = page.locator("summary:has-text('到期日历')").first();
  const visible = await details.count();
  if (visible) {
    await details.click();
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => {
      const panel = [...document.querySelectorAll("details")].find((node) => node.textContent?.includes("到期日历"));
      if (!panel) return null;
      const text = panel.innerText;
      const buttons = panel.querySelectorAll("button").length;
      return { text: text.slice(0, 120), buttons, month: (text.match(/\d{4} 年 \d+ 月/) ?? [])[0] ?? null };
    });
    record("到期日历可展开并显示月份标题", Boolean(state?.month), JSON.stringify(state));
    record("到期日历有导航与日期格", (state?.buttons ?? 0) > 28, `buttons=${state?.buttons}`);
  } else record("到期日历入口存在", false, "找不到 summary");
}

// 2) 详情页变更记录
{
  await page.goto(`${BASE}/items/${ids[0]}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const hasHistory = await page.evaluate(() => document.body.innerText.includes("变更记录"));
  record("详情页显示「变更记录」", hasHistory, `body 含变更记录=${hasHistory}`);
  const hasCreate = await page.evaluate(() => /录入|新建|CREATE/.test(document.body.innerText));
  record("变更记录里有本次录入条目", hasCreate, "正文未出现录入类文案");
}

// 3) CSV 导出
{
  await page.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const exportButton = page.locator('button[aria-label="导出当前筛选为 CSV"]').first();
  const exists = await exportButton.count();
  record("物品页有导出按钮", exists === 1, `count=${exists}`);
  if (exists) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
      exportButton.click(),
    ]);
    if (download) {
      const path = await download.path();
      const fs = await import("node:fs");
      const content = fs.readFileSync(path, "utf8");
      record("下载了 CSV 文件", download.suggestedFilename().endsWith(".csv"), download.suggestedFilename());
      record("CSV 带 UTF-8 BOM(Excel 中文不乱码)", content.charCodeAt(0) === 0xfeff, `首个码点=${content.charCodeAt(0)}`);
      record("CSV 表头含名称/数量/到期日期", /名称/.test(content) && /数量/.test(content) && /到期日期/.test(content), content.split(/\r?\n/)[0]?.slice(0, 80));
      record("CSV 含刚才创建的物品", content.includes("P2-酸奶"), "未找到 P2-酸奶");
    } else record("下载了 CSV 文件", false, "未触发 download 事件");
  }
}

// 4) 批量改数量
{
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  await page.locator("main .group").first().click({ modifiers: [] }).catch(() => {});
  await page.waitForTimeout(400);
  // 进入选择模式
  const selectButton = page.locator('main button:has-text("选择")').first();
  if (await selectButton.count()) {
    await selectButton.click();
    await page.waitForTimeout(500);
    const checkbox = page.locator('[aria-label="选择物品"]:visible').first();
    if (await checkbox.count()) {
      await checkbox.click();
      await page.waitForTimeout(400);
      const editBatch = page.locator('button:has-text("批量编辑")').first();
      if (await editBatch.count()) {
        await editBatch.click();
        await page.waitForTimeout(700);
        const hasQuantity = await page.evaluate(() => Boolean(document.querySelector('[aria-label="批量数量"]')) && Boolean(document.querySelector('[aria-label="批量剩余量"]')));
        record("批量编辑弹窗有「数量」与「剩余量(%)」", hasQuantity, `quantity=${await page.locator('[aria-label="批量数量"]').count()} remaining=${await page.locator('[aria-label="批量剩余量"]').count()}`);
        // 填入 7 并提交
        await page.locator('[aria-label="批量数量"]').fill("7");
        await page.locator('[aria-label="批量剩余量"]').fill("40");
        const submit = page.locator('[role="dialog"] button[type="submit"]').first();
        if (await submit.count()) {
          await submit.click();
          await page.waitForTimeout(1500);
          // 批量编辑作用于「被勾选的那件」,不一定是 ids[0];两件里命中一件即说明生效。
          const after = await page.evaluate(async (ids) => {
            const rows = [];
            for (const id of ids) rows.push(await (await fetch(`/api/items/${id}`)).json());
            return rows;
          }, ids);
          const changed = after.find((row) => Number(row.quantity) === 7 && Number(row.remainingPercent) === 40);
          record("批量改数量生效", Boolean(changed), `实际=${JSON.stringify(after.map((row) => ({ name: row.name, quantity: row.quantity, remaining: row.remainingPercent })))}`);
          record("批量改剩余量生效", Boolean(changed), `实际=${JSON.stringify(after.map((row) => ({ name: row.name, quantity: row.quantity, remaining: row.remainingPercent })))}`);
        } else record("批量编辑可提交", false, "找不到 submit");
      } else record("批量编辑入口存在", false, "找不到按钮");
    } else record("选择模式可勾选物品", false, "找不到选择框");
  } else record("物品页有选择按钮", false, "找不到");
}

// 5) Service Worker 注册
{
  const sw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const registrations = await navigator.serviceWorker.getRegistrations();
    return { supported: true, count: registrations.length, script: registrations[0]?.active?.scriptURL ?? null };
  });
  record("Service Worker 已注册", sw.count > 0, JSON.stringify(sw));
}

// 清理
await page.evaluate(async (list) => {
  for (const id of list) await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) });
}, ids);
console.log("已清理");
await browser.close();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log("\n=== 失败项 ==="); for (const row of failed) console.log(`${row.name} → ${row.detail}`); }
process.exit(failed.length ? 1 : 0);