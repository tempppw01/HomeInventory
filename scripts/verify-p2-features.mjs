// 验证 P2 新增功能:详情页变更记录、CSV 导出、批量改数量、到期日历、SW 注册。
import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`); };

const browser = await launchChromium();
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
  // 新建「今天到期」的物品后,应用会按天自动弹出「提醒中心」,先关掉再操作日历。
  await dismissBlockingDialogs(page);
  // 再兜一层:任何仍然可见的弹层都关掉,避免它挡住日历的点击(CI 上出过这种超时)。
  for (let guard = 0; guard < 4; guard += 1) {
    const stillOpen = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getBoundingClientRect().height > 0));
    if (!stillOpen) break;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }
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
// 6) 列表截断必须说清:扫码消耗记录面板
{
  // 先拿接口的真实总数(接口一次最多给 100 条,总数在响应头里)
  const scanProbe = await page.evaluate(async () => {
    const response = await fetch("/api/activity?scan=1", { cache: "no-store" });
    const rows = await response.json();
    return { returned: Array.isArray(rows) ? rows.length : 0, total: Number(response.headers.get("x-total-count") ?? "-1") };
  });
  record("接口带上了真实总数(X-Total-Count)", scanProbe.total >= 0, JSON.stringify(scanProbe));

  // 数据页「最近操作」:标题要带总数与「只列最近 5 条」
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);
  {
    const group = page.locator('summary:has-text("数据安全"), summary:has-text("数据与部署")').first();
    if (await group.count()) { await group.click().catch(() => {}); await page.waitForTimeout(2000); }
  }
  const recentCopy = await page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const match = /最近操作[^。]{0,40}/.exec(text);
    return match ? match[0] : null;
  });
  // 自动备份的状态必须能在界面上看到(此前完全没有显示,失败也被 .catch(() => undefined) 吞掉)
  const autoBackupCopy = await page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const index = text.indexOf("自动备份状态");
    return index >= 0 ? text.slice(index, index + 120) : null;
  });
  record(
    "设置页显示自动备份状态(含上次成功时间或「还没成功过」)",
    Boolean(autoBackupCopy) && /(上次成功|还没有成功执行过|正在读取)/.test(autoBackupCopy),
    autoBackupCopy ?? "(没找到这一行)",
  );

  // 「从服务器上的备份恢复」下拉里的每一条,都要看得出是不是本库的备份。
  // 只列文件名时,同一台机器上另一份实例的备份看着就是个随机后缀(实测家庭库那份当日备份
  // 被探针实例顶掉过,当时界面上完全看不出哪份是谁写的)。先真跑一次自动备份再重载页面,
  // 保证下拉一定渲染出来 —— 否则这条断言会因为「还没备份过」而空过。
  await page.evaluate(async () => { try { await fetch("/api/backup/auto", { method: "POST" }); } catch { /* 让下面的断言去说 */ } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await dismissBlockingDialogs(page);
  {
    const group = page.locator('summary:has-text("数据安全"), summary:has-text("数据与部署")').first();
    if (await group.count()) { await group.click().catch(() => {}); await page.waitForTimeout(1500); }
  }
  const backupOptions = await page.evaluate(() => {
    const select = [...document.querySelectorAll("select")].find((node) => [...node.options].some((option) => /^home-inventory-/.test(option.value)));
    return select ? [...select.options].map((option) => ({ value: option.value, label: option.textContent })) : null;
  });
  const labelsOk = Array.isArray(backupOptions) && backupOptions.length > 0
    && backupOptions.every((option) => /^\d{4}-\d{2}-\d{2} · (本机|另一份库\([0-9a-f]{6}\)|未标明来源)$/.test(option.label ?? ""))
    // 刚 POST 过的那份就是本库写的,所以至少有一条必须认成「本机」
    && backupOptions.some((option) => / · 本机$/.test(option.label ?? ""));
  record(
    "「从服务器上的备份恢复」每一条都写清是本机、另一份库还是未标明来源",
    labelsOk,
    JSON.stringify(backupOptions ?? "(没找到这个下拉)").slice(0, 240),
  );
  const backupHint = await page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const index = text.indexOf("写这份备份的那个库");
    return index >= 0 ? text.slice(Math.max(0, index - 40), index + 100) : null;
  });
  record(
    "下拉旁边说明了那 6 位十六进制是什么(不是丢给人一个看不懂的后缀)",
    Boolean(backupHint) && /指纹/.test(backupHint),
    backupHint ?? "(没找到这句说明)",
  );

  record(
    "数据页「最近操作」带上真实总数并说明只列最近 5 条",
    Boolean(recentCopy) && /共 \d+ 条/.test(recentCopy) && /只列最近 5 条/.test(recentCopy),
    `实际=${recentCopy ?? "(没找到)"}`,
  );

  // 详情页「变更记录」:要给出真实总数,并在超出时说明「以下是最近 N 条」
  {
    // 自己造一条历史:挑一件在库物品,改一下备注(会产生一条 UPDATE 活动记录),
    // 再打开它的详情页 —— 这样不依赖「库里恰好有带历史的物品」(试过两种找法都不稳)。
    const seeded = await page.evaluate(async () => {
      const all = await (await fetch("/api/items?includeDeleted=1", { cache: "no-store" })).json();
      const live = (Array.isArray(all) ? all : []).find((item) => !item.deletedAt);
      if (!live) return null;
      const stamp = new Date().toISOString().slice(11, 19);
      const response = await fetch(`/api/items/${live.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: `变更记录检查 ${stamp}` }),
      });
      return { id: live.id, name: live.name, patched: response.status };
    });
    let copy = null;
    if (seeded) {
      await page.goto(`${BASE}/items/${seeded.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2400);
      copy = await page.evaluate(() => {
        const text = (document.body.innerText || "").replace(/\s+/g, " ");
        const index = text.indexOf("变更记录");
        return index >= 0 ? text.slice(index, index + 60) : null;
      });
      record("改一下备注就能产生一条变更记录(前置成立)", seeded.patched === 200, `PATCH=${seeded.patched}`);
    }
    record(
      "详情页「变更记录」给出真实总数,超出时说明「以下是最近 12 条」",
      Boolean(copy) && /共 \d+ 条/.test(copy) && !/^变更记录 最近 12 条,倒序$/.test(copy),
      `实际=${copy ?? "(没找到)"}`,
    );
  }

  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissBlockingDialogs(page);
  // 面板在折叠的分组里,先展开它
  const group = page.locator('summary:has-text("数据安全"), summary:has-text("数据与部署")').first();
  if (await group.count()) { await group.click().catch(() => {}); await page.waitForTimeout(2200); }
  const panel = await page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const index = text.indexOf("扫码消耗记录");
    const badge = /扫码消耗记录[^0-9]{0,20}共 (\d+) 条/.exec(text);
    return {
      found: index >= 0,
      snippet: index >= 0 ? text.slice(index, index + 110) : text.slice(0, 120),
      badgeTotal: badge ? Number(badge[1]) : null,
      hasTruncationNote: /以下只列最近 12 条/.test(text),
    };
  });
  record("设置页能看到「扫码消耗记录」面板(防止空跑)", panel.found, panel.snippet);
  record(
    "徽标显示的是真实总数,而不是被接口上限截断的 100",
    panel.badgeTotal !== null && panel.badgeTotal === scanProbe.total && panel.badgeTotal >= scanProbe.returned,
    `徽标=${panel.badgeTotal} 接口总数=${scanProbe.total} 接口返回条数=${scanProbe.returned}`,
  );
  record(
    "列表被截断时明确说明「以下只列最近 12 条」",
    scanProbe.total > 12 ? panel.hasTruncationNote : true,
    panel.snippet,
  );
}

await browser.close();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log("\n=== 失败项 ==="); for (const row of failed) console.log(`${row.name} → ${row.detail}`); }
process.exit(failed.length ? 1 : 0);