// Verification probe for this round: the entry-form fixes from
// output/findings/entry.md (P1 x5 / P2 x7) plus the new top progress effect and
// the "one thing first" dashboard. Every check prints PASS/FAIL with the value
// it measured, so nothing here is asserted from reading the source.
//
//   BASE_URL=http://127.0.0.1:3001 PROBE_USER=leadcheck PROBE_PASS=... node scripts/verify-entry-fixes.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "leadcheck";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");
const OUT = "output/experience";
await mkdir(OUT, { recursive: true });

const EXECUTABLE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const PREFIX = "ENT2-";
const login = async (page) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#auth-username", { timeout: 20000 });
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[aria-label="概览"]', { timeout: 20000 });
  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
  await skip.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(700); }
  await page.waitForFunction(() => document.querySelectorAll("[role=dialog][aria-modal=true]").length === 0, null, { timeout: 4000 }).catch(() => {});
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const posts = [];
page.on("request", (request) => {
  if (request.method() === "POST" && new URL(request.url()).pathname === "/api/items") posts.push(Date.now());
});
await login(page);

const dialog = () => page.locator('[role="dialog"][aria-label="录入新物品"]');
const qty = () => page.locator('input[aria-describedby="quantity-hint"]');
const unitSelect = () => page.locator("select").filter({ has: page.locator("option", { hasText: "kg" }) });
const openCreate = async () => {
  await page.locator('button[aria-label="录入物品"]:visible').first().click();
  await dialog().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(450);
};

// ------------------------------------------------------------------ P2-6 / P2-12
await openCreate();
const labels = await page.evaluate(() => {
  const quantity = document.querySelector('input[aria-describedby="quantity-hint"]');
  const name = document.querySelector("#item-name");
  const textOf = (element) => {
    const field = element?.closest("label") || element?.parentElement;
    return field ? field.textContent.slice(0, 24) : "";
  };
  return {
    nameLabels: name ? name.labels.length : -1,
    nameLabelText: name?.labels?.[0]?.textContent?.trim() || "",
    quantityFieldText: textOf(quantity),
    requiredFields: [...document.querySelectorAll('[role=dialog] input[required], [role=dialog] textarea[required]')].length,
  };
});
check("名称输入框有关联 label(读屏可播报)", labels.nameLabels > 0, `labels=${labels.nameLabels} text="${labels.nameLabelText}"`);
check("数量字段带必填星号", labels.quantityFieldText.includes("*"), `field="${labels.quantityFieldText}"`);

// ------------------------------------------------------------------ P1-5 / P2-8
await qty().fill("");
const cleared = await qty().inputValue();
check("数量可以清空(不再残留 0)", cleared === "", `value="${cleared}"`);
await qty().fill("2.5");
const typing = await qty().inputValue();
await qty().blur();
await page.waitForTimeout(220);
const afterBlur = await qty().inputValue();
const hintText = await page.locator("#quantity-hint").textContent();
check("计数单位输入 2.5 时不会被静默改写", typing === "2.5", `typing="${typing}" -> blur="${afterBlur}"`);
check("计数单位给出「只能填整数」提示", /整数/.test(hintText || ""), `hint="${(hintText || "").trim()}"`);
check("计数单位失焦后取整为 3", afterBlur === "3", `value="${afterBlur}"`);
await unitSelect().selectOption("kg");
await page.waitForTimeout(200);
const metricHint = await page.locator("#quantity-hint").textContent();
check("计量单位提示可以填小数", /小数/.test(metricHint || ""), `hint="${(metricHint || "").trim()}"`);

// ------------------------------------------------------------------------ P1-4
await dialog().locator('label:has-text("消耗品")').first().click();
await page.waitForTimeout(250);
await unitSelect().selectOption("件");
await page.waitForTimeout(250);
const sliderCount = await dialog().locator('input[aria-label="剩余量"]').count();
await unitSelect().selectOption("瓶");
await page.waitForTimeout(250);
const sliderBottle = await dialog().locator('input[aria-label="剩余量"]').count();
check("非液体消耗品不再出现「剩余量」滑块", sliderCount === 0, `单位=件 slider=${sliderCount}`);
check("液体消耗品仍然出现「剩余量」滑块", sliderBottle === 1, `单位=瓶 slider=${sliderBottle}`);

// ----------------------------------------------------------------------- P2-10
await unitSelect().selectOption("件");
await page.waitForTimeout(200);
const order = await page.evaluate(() => {
  const quantity = document.querySelector('input[aria-describedby="quantity-hint"]');
  const imageToggle = [...document.querySelectorAll("button[aria-expanded]")].find((b) => b.textContent.includes("图片"));
  const y = (element) => (element ? element.getBoundingClientRect().top : -1);
  return {
    quantityY: Math.round(y(quantity)),
    imageY: Math.round(y(imageToggle)),
    imageExpanded: imageToggle?.getAttribute("aria-expanded") || "(none)",
    linkFieldVisible: [...document.querySelectorAll("input")].some((i) => (i.placeholder || "").includes("粘贴图片地址") && i.offsetParent !== null),
  };
});
check("必填「数量」排在可选图片区之前", order.quantityY < order.imageY && order.quantityY > 0, `quantityY=${order.quantityY} imageY=${order.imageY}`);
check("图片区默认折叠", order.imageExpanded === "false" && !order.linkFieldVisible, `aria-expanded=${order.imageExpanded} linkFieldVisible=${order.linkFieldVisible}`);

// ------------------------------------------------------------------------ P2-7
await writeFile(`${OUT}/entry-upload-bad.txt`, "not an image", "utf8");
await page.locator("button[aria-expanded]").filter({ hasText: "图片" }).first().click();
await page.waitForTimeout(300);
await page.locator('[role="dialog"] input[type="file"]').setInputFiles(`${OUT}/entry-upload-bad.txt`);
await page.waitForTimeout(600);
const uploadError = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[role="dialog"] p')].map((p) => p.textContent.trim());
  return nodes.find((text) => /只支持|无法作为图片读取|超过 20MB/.test(text)) || "";
});
check("上传非图片时提示为中文且说明原因", /只支持|无法作为图片读取/.test(uploadError) && !/The source image/i.test(uploadError), `error="${uploadError}"`);

// ----------------------------------------------------------------------- P2-11
const sticky = await page.evaluate(() => {
  const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes("快速保存") || b.textContent.includes("保存修改"));
  const row = button?.parentElement;
  if (!row) return null;
  const style = getComputedStyle(row);
  return { position: style.position, bottom: style.bottom, overflowY: getComputedStyle(row.parentElement).overflowY };
});
check("底部操作条为 sticky,键盘弹起时保存键仍可达", sticky?.position === "sticky" && sticky?.bottom === "0px", JSON.stringify(sticky));

// ----------------------------------------------------------------- P1-1 / P1-3
await page.fill("#item-name", `${PREFIX}主检查`);
await qty().fill("0");
await page.locator('[role="dialog"] button:has-text("快速保存")').click();
await page.waitForTimeout(900);
const zeroState = await page.evaluate(() => ({
  error: [...document.querySelectorAll('[role="dialog"] p')].map((p) => p.textContent.trim()).find((t) => t.includes("数量至少")) || "",
  dialogOpen: Boolean(document.querySelector('[role="dialog"][aria-label="录入新物品"]')),
}));
check("数量 0 被拦下并给出中文说明", Boolean(zeroState.error) && zeroState.dialogOpen, `error="${zeroState.error}"`);
const postsAfterZero = posts.length;
check("数量 0 不会发出创建请求", postsAfterZero === 0, `POST /api/items = ${postsAfterZero}`);

await page.locator('[role="dialog"] button:has-text("更多信息")').click();
await page.waitForTimeout(400);
const priceInput = page.locator('[role="dialog"] input[placeholder="¥ 0.00"]');
await priceInput.fill(".");
await page.locator('[role="dialog"] button:has-text("快速保存")').click();
await page.waitForTimeout(700);
const blocked = posts.length;
await priceInput.fill("19.90");
await qty().fill("2");
await page.locator('[role="dialog"] button:has-text("快速保存")').click();
await page.waitForTimeout(1500);
const afterFix = posts.length;
const closed = (await dialog().count()) === 0;
check("非法单价不会把提交锁死在 true", blocked === 0, `非法单价阶段 POST = ${blocked}`);
check("改对价格后能正常保存并关闭弹窗", afterFix === 1 && closed, `POST = ${afterFix} closed=${closed}`);

// ------------------------------------------------------------------------ P1-2
await openCreate();
await page.fill("#item-name", `${PREFIX}双击检查`);
const before = posts.length;
const save = page.locator('[role="dialog"] button:has-text("快速保存")');
await save.click();
await page.waitForTimeout(160);
await save.click({ force: true }).catch(() => {});
await page.waitForTimeout(1600);
const doublePosts = posts.length - before;
check("双击「快速保存」只发出一次创建请求", doublePosts === 1, `POST = ${doublePosts}`);

// ------------------------------------------------------------------------ P2-9
await openCreate();
await page.fill("#item-name", `${PREFIX}未保存草稿`);
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
const confirmDialog = await page.locator('[role="dialog"][aria-label="放弃这次的填写?"]').count();
check("Escape 关闭已填表单前会二次确认", confirmDialog === 1, `confirmDialog=${confirmDialog}`);
await page.locator('[role="dialog"] button:has-text("继续填写")').click();
await page.waitForTimeout(600);
const keptName = await page.inputValue("#item-name");
check("选择「继续填写」后内容仍在", keptName.includes("未保存草稿"), `name="${keptName}"`);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
await page.locator('[role="dialog"] button:has-text("放弃并关闭")').click();
await page.waitForTimeout(900);
check("确认放弃后弹窗关闭", (await dialog().count()) === 0 && (await page.locator('[role="dialog"]').count()) === 0, `dialogs=${await page.locator('[role="dialog"]').count()}`);

// ------------------------------------------ 首屏:先说清「现在最该做什么」+ 降干扰
const firstScreen = await page.evaluate(() => {
  const overview = document.querySelector("section.dashboard-overview");
  const finance = [...document.querySelectorAll("details")].find((item) => item.textContent.includes("家庭消费"));
  const navButton = [...document.querySelectorAll('button[aria-label="任务"]')].find((element) => element.offsetParent !== null);
  return {
    headline: overview?.querySelector("h2")?.textContent?.trim() || "",
    primaryAction: overview?.querySelector("button")?.textContent?.trim() || "",
    buttonsInOverview: overview ? overview.querySelectorAll("button").length : 0,
    legacyBanner: document.body.innerText.includes("件物品已经过期") || document.body.innerText.includes("需要你的关注"),
    financeOpen: finance ? finance.open : null,
    navLabelText: navButton?.textContent?.trim() || "",
    collapseToggle: Boolean(document.querySelector('[aria-label="展开侧栏"]')),
    statsRow: overview?.textContent?.includes("低库存") || false,
  };
});
check("首屏用一句话说明现在最该做什么", Boolean(firstScreen.headline) && Boolean(firstScreen.primaryAction), `headline="${firstScreen.headline}" action="${firstScreen.primaryAction}" buttons=${firstScreen.buttonsInOverview}`);
check("重复的旧提醒横幅已移除", !firstScreen.legacyBanner, `legacyBanner=${firstScreen.legacyBanner}`);
check("「家庭消费」默认折叠(辅助信息隐藏)", firstScreen.financeOpen === false, `open=${firstScreen.financeOpen}`);
check("侧栏默认折叠(首屏降低干扰)", firstScreen.collapseToggle && firstScreen.navLabelText === "", `collapseToggle=${firstScreen.collapseToggle} navText="${firstScreen.navLabelText}"`);

// 关键时刻自动弹出:库里出现已过期物品时,打开应用自动弹一次「提醒中心」,同一天不再重复。
const expiredFixture = await page.evaluate(async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const response = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "ENT2-过期检查", category: "食品", type: "CONSUMABLE", quantity: 2, minQuantity: 0, remainingPercent: 100, unit: "盒", price: null, purchaseDate: null, expiryDate: yesterday, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null }),
  });
  const item = await response.json().catch(() => null);
  localStorage.removeItem(`home-inventory-expiry-notice-${new Date().toISOString().slice(0, 10)}`);
  return { id: item?.id ?? null, ok: response.ok };
});
check("已过期探针物品创建成功", expiredFixture.ok && Boolean(expiredFixture.id), JSON.stringify(expiredFixture));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[aria-label="概览"]', { timeout: 20000 });
const autoOpen = await page.locator('[role="dialog"][aria-label="提醒中心"]').first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
check("有物品过期时自动弹出「提醒中心」", autoOpen, `autoOpened=${autoOpen}`);
if (autoOpen) { await page.keyboard.press("Escape"); await page.waitForTimeout(700); }

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[aria-label="概览"]', { timeout: 20000 });
await page.waitForTimeout(2600);
const secondOpen = await page.locator('[role="dialog"][aria-label="提醒中心"]').count();
check("同一天不会重复弹出(日常不打扰)", secondOpen === 0, `dialogs=${secondOpen}`);

// ---------------------------------------------------------------- 顶部进度效果
const idle = await page.evaluate(() => {
  const bar = document.querySelector('[role="progressbar"]');
  if (!bar) return null;
  const style = getComputedStyle(bar);
  const rect = bar.getBoundingClientRect();
  return { hidden: bar.getAttribute("aria-hidden"), pointerEvents: style.pointerEvents, zIndex: style.zIndex, top: Math.round(rect.top), height: Math.round(rect.height), position: style.position };
});
check("顶部进度条存在且空闲时 aria-hidden", Boolean(idle) && idle.hidden === "true", JSON.stringify(idle));
check("进度条不拦截点击且层级高", idle?.pointerEvents === "none" && Number(idle?.zIndex) >= 200, `pointer-events=${idle?.pointerEvents} z-index=${idle?.zIndex}`);
check("进度条贴顶且极细(≤4px)", idle?.position === "fixed" && idle?.top === 0 && idle?.height <= 4, `position=${idle?.position} top=${idle?.top} height=${idle?.height}`);

const started = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent("home-inventory:progress", { detail: "start" }));
  await new Promise((resolve) => setTimeout(resolve, 260));
  const bar = document.querySelector('[role="progressbar"]');
  const fill = bar?.firstElementChild;
  return { hidden: bar?.getAttribute("aria-hidden"), width: fill ? Math.round(fill.getBoundingClientRect().width) : 0 };
});
check("派发 start 后进度条运行", started.hidden === "false" && started.width > 0, JSON.stringify(started));

const navProgress = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent("home-inventory:progress", { detail: "done" }));
  const nav = [...document.querySelectorAll('[aria-label="物品"]')].find((element) => element.offsetParent !== null);
  nav.click();
  const samples = [];
  for (let index = 0; index < 14; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    samples.push(document.querySelector('[role="progressbar"]')?.getAttribute("aria-hidden"));
  }
  return { samples, ran: samples.includes("false") };
});
check("切换视图时顶部进度条自动出现", navProgress.ran, `samples=${navProgress.samples.join(",")}`);

const overlay = await page.evaluate(() => {
  const element = document.elementFromPoint(window.innerWidth / 2, 1);
  return { tag: element?.tagName || "", inBar: Boolean(element?.closest('[role="progressbar"]')) };
});
check("进度条不会盖住顶栏按钮的点击", !overlay.inBar, JSON.stringify(overlay));

await page.waitForTimeout(900);

// ------------------------------------------------------------------------- 清理
const cleanup = await page.evaluate(async (prefix) => {
  const list = async () => {
    const body = await (await fetch("/api/items?includeDeleted=1")).json();
    return Array.isArray(body) ? body : (body?.items ?? []);
  };
  const items = (await list()).filter((item) => item.name.startsWith(prefix));
  for (const item of items) {
    await fetch(`/api/items/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permanent: true }) });
  }
  const remaining = (await list()).filter((item) => item.name.startsWith(prefix));
  return { removed: items.length, remaining: remaining.length, names: items.map((item) => item.name) };
}, PREFIX);
check("探针物品已彻底清理", cleanup.removed > 0 && cleanup.remaining === 0, JSON.stringify(cleanup));

await context.close();
await browser.close();
const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
await writeFile(`${OUT}/entry-fixes.json`, JSON.stringify({ passed, total: results.length, results, cleanup }, null, 1), "utf8");
console.log(`report -> ${OUT}/entry-fixes.json`);
process.exit(passed === results.length ? 0 : 1);
