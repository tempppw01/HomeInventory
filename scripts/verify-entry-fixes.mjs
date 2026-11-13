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

// ------------------------------------------------------ 耐用品 / 消耗品自动识别
await openCreate();
const typeState = () => page.evaluate(() => {
  const radios = [...document.querySelectorAll('[role="dialog"] input[type="radio"]')];
  const hint = [...document.querySelectorAll('[role="dialog"] div')].map((node) => node.textContent.trim()).find((text) => text.startsWith("已按名称识别为")) || "";
  return { durable: Boolean(radios[0]?.checked), consumable: Boolean(radios[1]?.checked), hint };
});
await page.locator("#item-name").fill("洗衣液 2L");
await page.waitForTimeout(1000);
const soapGuess = await typeState();
check("输入「洗衣液」自动识别为消耗品并说明依据", soapGuess.consumable && /消耗品/.test(soapGuess.hint) && /洗衣液/.test(soapGuess.hint), JSON.stringify(soapGuess));
await dialog().locator('label:has-text("耐用品")').first().click();
await page.waitForTimeout(400);
const manualType = await typeState();
check("手动改成耐用品后不被自动改回", manualType.durable && manualType.hint === "", JSON.stringify(manualType));
await page.locator("#item-name").fill("投影仪");
await page.waitForTimeout(1000);
const afterManual = await typeState();
check("用户手动选过类型后不再自动识别", afterManual.durable && afterManual.hint === "", JSON.stringify(afterManual));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const discardType = page.locator('[role="dialog"] button:has-text("放弃并关闭")');
if (await discardType.count()) { await discardType.first().click(); await page.waitForTimeout(600); }

await openCreate();
await page.locator("#item-name").fill("投影仪");
await page.waitForTimeout(1000);
const durableGuess = await typeState();
check("耐用品名称保持耐用品并给出依据", durableGuess.durable && /耐用品/.test(durableGuess.hint), JSON.stringify(durableGuess));
await page.locator("#item-name").fill("儿童绘本");
await page.waitForTimeout(1000);
const noSignal = await typeState();
check("没有把握时不显示识别提示", noSignal.hint === "", JSON.stringify(noSignal));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const discardNoSignal = page.locator('[role="dialog"] button:has-text("放弃并关闭")');
if (await discardNoSignal.count()) { await discardNoSignal.first().click(); await page.waitForTimeout(600); }

// ------------------------------------------------- 盘点扫码(相机/屏幕/图片/手动)
const fixtureItem = await page.evaluate(async () => {
  const list = async () => { const body = await (await fetch("/api/items")).json(); return Array.isArray(body) ? body : (body?.items ?? []); };
  const items = await list();
  if (items.length) { const first = items[0]; return { code: first.itemCode || first.id, id: first.id, created: false }; }
  const created = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ENT2-扫码检查", category: "日用", type: "DURABLE", quantity: 1, minQuantity: 0, remainingPercent: 100, unit: "件", price: null, purchaseDate: null, expiryDate: null, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null }) });
  if (!created.ok) return null;
  const item = await created.json();
  return { code: item.itemCode || item.id, id: item.id, created: true };
});
await page.locator('[aria-label="盘点"]:visible').first().click();
await page.waitForTimeout(1500);
const scanEntry = page.locator('button[aria-label="扫码盘点"]:visible').first();
check("盘点页有扫码入口", (await scanEntry.count()) === 1, "count=" + (await scanEntry.count()));
if ((await scanEntry.count()) === 1) {
  await scanEntry.click();
  await page.waitForTimeout(1000);
  const scanner = await page.evaluate(() => {
    const modal = document.querySelector('[data-source][data-status]');
    if (!modal) return null;
    return {
      source: modal.getAttribute("data-source"),
      status: modal.getAttribute("data-status"),
      role: modal.getAttribute("role"),
      zIndex: getComputedStyle(modal).zIndex,
      chips: [...modal.querySelectorAll('[data-source-chip]')].map((node) => node.textContent.trim()),
      unsupported: modal.textContent.includes("当前浏览器不支持自动识别"),
    };
  });
  check("扫码弹窗是 dialog 且有相机/屏幕/图片/手动入口", Boolean(scanner) && scanner.role === "dialog" && scanner.chips.includes("相机") && scanner.chips.includes("图片") && scanner.chips.includes("手动"), JSON.stringify(scanner));
  if (scanner && scanner.chips.includes("手动")) {
    await page.locator('[data-source-chip="manual"]').click();
    await page.waitForTimeout(400);
    await page.locator('input[aria-label="物品编号"]').fill("https://example.com/items/" + (fixtureItem?.code || ""));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    const scannerText = await page.evaluate(() => document.querySelector('[data-source][data-status]')?.textContent || "");
    const pageText = await page.evaluate(() => document.body.innerText);
    const progress = pageText.match(/进度\s*(\d+)\s*\/\s*(\d+)/);
    check("手动输入 URL 形式的编号能盘点入账", /已盘点/.test(scannerText) && /已确认/.test(pageText) && Boolean(progress) && Number(progress[1]) >= 1, "progress=" + (progress ? progress[1] + "/" + progress[2] : "?") + " feedback=" + /已盘点[^)]{0,30}\)/.exec(scannerText)?.[0]);
    await page.locator('input[aria-label="物品编号"]').fill("INV-NOT-EXIST");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const notFound = await page.evaluate(() => document.body.innerText.includes("没有找到这个物品"));
    check("未知编号给出中文提示", notFound, "toast=" + notFound);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const scannerGone = await page.evaluate(() => document.querySelectorAll('[data-source][data-status]').length);
  check("Escape 能关掉扫码弹窗", scannerGone === 0, "open=" + scannerGone);
}
if (fixtureItem?.created && fixtureItem.id) {
  await page.evaluate(async (id) => { await fetch("/api/items/" + id, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permanent: true }) }); }, fixtureItem.id);
}
await page.locator('[aria-label="概览"]:visible').first().click();
await page.waitForTimeout(1200);
// ------------------------------------------------------------------ 日期选择器
// 旧版是原生 <input type="date"> + 三个 36px 纯图标快捷键(到期日期还复用了采购
// 日期的「昨天/上周」)。现在统一走 DatePicker:可见文字、按语义分组的快捷项、
// min/max、相对提示、键盘与 Escape 分层。
const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const todayKey = addDays(0);

await openCreate();
// 日期字段在「更多信息」里,先展开再找触发器。
await page.locator('[role="dialog"] button:has-text("更多信息")').click();
await page.waitForTimeout(500);
const nativeDateInputs = await page.evaluate(() => document.querySelectorAll('[role="dialog"] input[type="date"]').length);
const purchaseTrigger = page.locator('button[data-date-picker-trigger][aria-label="购入日期"]').first();
const triggerInfo = await purchaseTrigger.evaluate((node) => ({ haspopup: node.getAttribute("aria-haspopup"), expanded: node.getAttribute("aria-expanded"), usesInputClass: node.className.includes("input") }));
check("日期字段不再是原生 input[type=date]", nativeDateInputs === 0 && triggerInfo.haspopup === "dialog" && triggerInfo.usesInputClass, "native=" + nativeDateInputs + " haspopup=" + triggerInfo.haspopup + " inputClass=" + triggerInfo.usesInputClass);

await purchaseTrigger.click();
await page.waitForTimeout(450);
const purchasePanel = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="购入日期"]');
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  return {
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    portal: panel.parentElement === document.body,
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    innerHeight: window.innerHeight,
    chips: [...panel.querySelectorAll("button")].map((node) => node.textContent.trim()).filter(Boolean),
  };
});
check("日期面板 portal 到 body 且完整在视口内", Boolean(purchasePanel) && purchasePanel.portal && purchasePanel.top >= 0 && purchasePanel.bottom <= purchasePanel.innerHeight && purchasePanel.dialogs === 2, purchasePanel ? JSON.stringify({ dialogs: purchasePanel.dialogs, top: purchasePanel.top, bottom: purchasePanel.bottom, width: purchasePanel.width }) : "no panel");
check("购入日期快捷项只给过去语义", Boolean(purchasePanel) && ["今天", "昨天", "3 天前", "上周", "1 个月前"].every((label) => purchasePanel.chips.includes(label)) && !purchasePanel.chips.includes("3 天后"), purchasePanel ? "chips=" + purchasePanel.chips.join("/") : "no panel");

const gridInfo = await page.evaluate((today) => {
  const cells = [...document.querySelectorAll('[role="dialog"][aria-label="购入日期"] [role="grid"] button[data-date]')];
  const future = cells.filter((node) => node.getAttribute("data-date") > today);
  return { total: cells.length, future: future.length, futureDisabled: future.filter((node) => node.disabled).length, rows: document.querySelectorAll('[role="dialog"][aria-label="购入日期"] [role="grid"] [role="row"]').length };
}, todayKey);
check("日历 6 行 × 7 列且超出 max 的日期禁用", gridInfo.total === 42 && gridInfo.rows === 6 && gridInfo.future > 0 && gridInfo.futureDisabled === gridInfo.future, JSON.stringify(gridInfo));

await page.locator('[role="dialog"][aria-label="购入日期"] button').filter({ hasText: /^今天$/ }).first().click();
await page.waitForTimeout(450);
const afterPick = await purchaseTrigger.evaluate((node) => ({ value: node.getAttribute("data-value"), expanded: node.getAttribute("aria-expanded"), text: node.textContent.trim().slice(0, 12) }));
check("点「今天」写入今天并关闭面板", afterPick.value === todayKey && afterPick.expanded === "false", JSON.stringify(afterPick));

await purchaseTrigger.click();
await page.waitForTimeout(450);
await page.keyboard.press("Escape");
await page.waitForTimeout(450);
const afterDateEscape = await page.evaluate(() => ({ panel: document.querySelectorAll('[role="dialog"][aria-label="购入日期"]').length, itemModal: document.querySelectorAll('[role="dialog"][aria-label="录入新物品"]').length, focus: document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName }));
check("Escape 只关日期面板,录入弹窗还在", afterDateEscape.panel === 0 && afterDateEscape.itemModal === 1 && afterDateEscape.focus === "购入日期", JSON.stringify(afterDateEscape));

await purchaseTrigger.click();
await page.waitForTimeout(450);
const manualInput = page.locator('[role="dialog"][aria-label="购入日期"] input[aria-label="手动输入日期"]');
await manualInput.fill("2026/3/15");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const manualValue = await purchaseTrigger.evaluate((node) => node.getAttribute("data-value"));
check("手动输入 2026/3/15 解析为 2026-03-15", manualValue === "2026-03-15", "data-value=" + manualValue);

await purchaseTrigger.click();
await page.waitForTimeout(450);
await manualInput.fill("abc");
await page.keyboard.press("Enter");
await page.waitForTimeout(450);
const invalidInput = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="购入日期"]');
  return { alert: panel?.querySelector('[role="alert"]')?.textContent.trim() || "", value: panel?.querySelector('input[aria-label="手动输入日期"]')?.value ?? "", open: Boolean(panel) };
});
check("非法日期给中文错误且不清空输入", invalidInput.open && Boolean(invalidInput.alert) && invalidInput.value === "abc", JSON.stringify(invalidInput));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

await dialog().locator('label:has-text("消耗品")').first().click();
await page.waitForTimeout(400);
const expiryTrigger = page.locator('button[data-date-picker-trigger][aria-label="到期日期"]').first();
await expiryTrigger.click();
await page.waitForTimeout(450);
const expiryChips = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="到期日期"] button')].map((node) => node.textContent.trim()).filter(Boolean));
check("到期日期快捷项不再出现「昨天/上周」", ["3 天后", "1 周后", "1 个月后", "1 年后"].every((label) => expiryChips.includes(label)) && !expiryChips.includes("昨天") && !expiryChips.includes("上周"), "chips=" + expiryChips.join("/"));
await page.locator('[role="dialog"][aria-label="到期日期"] button').filter({ hasText: /^3 天后$/ }).first().click();
await page.waitForTimeout(450);
const expiryState = await expiryTrigger.evaluate((node) => ({ value: node.getAttribute("data-value"), relative: node.querySelector("[data-relative-text]")?.textContent.trim() || node.textContent.trim().slice(0, 20) }));
check("到期日期显示「还有 N 天」", expiryState.value === addDays(3) && /还有 3 天/.test(expiryState.relative), JSON.stringify(expiryState));

// 关掉录入弹窗(已填过日期 → 会先问是否放弃)
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const discardItem = page.locator('[role="dialog"] button:has-text("放弃并关闭")');
if (await discardItem.count()) { await discardItem.first().click(); await page.waitForTimeout(600); }

await page.locator('[aria-label="任务"]:visible').first().click();
await page.waitForTimeout(1200);
const addTask = page.locator('main button:has-text("安排任务")').first();
if (await addTask.count()) {
  await addTask.click();
  await page.waitForTimeout(900);
  const taskDate = await page.evaluate(() => ({ trigger: Boolean(document.querySelector('[role="dialog"] button[data-date-picker-trigger][aria-label="下次日期"]')), native: document.querySelectorAll('[role="dialog"] input[type="date"]').length }));
  check("任务「下次日期」用同一套日期面板", taskDate.trigger && taskDate.native === 0, JSON.stringify(taskDate));
  await page.locator('[role="dialog"] button[aria-label="下次日期"]').first().click();
  await page.waitForTimeout(500);
  const taskChips = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="下次日期"] button')].map((node) => node.textContent.trim()).filter(Boolean));
  check("任务快捷项含「明天」", taskChips.includes("明天") && taskChips.includes("1 个月后"), "chips=" + taskChips.join("/"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const discardTask = page.locator('[role="dialog"] button:has-text("放弃并关闭")');
  if (await discardTask.count()) { await discardTask.first().click(); await page.waitForTimeout(500); }
} else {
  check("任务「安排任务」入口可达", false, "未找到入口");
}

// 回到概览,后面的首屏断言依赖它
await page.locator('[aria-label="概览"]:visible').first().click();
await page.waitForTimeout(1400);
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

// --------------------------------------------------------- 设置页元素一致性
// 7 个面板原来由 5 个文件各写一套卡片/标题/行距/控件,统一到 settings-primitives 之后:
// 全部默认折叠、行 56px + 发丝分隔、图标块 44/36、勾选框换成 role=switch、手机不再横向溢出。
await page.locator('[aria-label="设置"]:visible').first().click();
await page.waitForTimeout(1500);
const settingsFolded = await page.evaluate(() => {
  const main = document.querySelector("main");
  const details = [...main.querySelectorAll("details")];
  const fontSizeOf = (node) => { const style = getComputedStyle(node); return style.fontSize + "/" + style.fontWeight; };
  return {
    details: details.length,
    open: details.filter((node) => node.open).length,
    classes: [...new Set(details.map((node) => node.className))],
    radii: [...new Set(details.map((node) => getComputedStyle(node).borderRadius))],
    pads: [...new Set(details.map((node) => getComputedStyle(node).padding))],
    titles: [...new Set(details.map((node) => { const title = node.querySelector("summary span span"); return title ? fontSizeOf(title) : "none"; }))],
    icons: [...new Set(details.map((node) => { const icon = node.querySelector("summary > span:first-child"); if (!icon) return "none"; const rect = icon.getBoundingClientRect(); return Math.round(rect.width) + "x" + Math.round(rect.height); }))],
  };
});
check("设置页 8 个面板默认全部折叠", settingsFolded.details === 8 && settingsFolded.open === 0, JSON.stringify({ details: settingsFolded.details, open: settingsFolded.open }));
check("面板容器样式完全一致", settingsFolded.classes.length === 1 && settingsFolded.radii.length === 1 && settingsFolded.pads.length === 1, JSON.stringify({ classes: settingsFolded.classes.length, radii: settingsFolded.radii, pads: settingsFolded.pads }));
check("面板标题与图标块尺寸一致", settingsFolded.titles.length === 1 && settingsFolded.icons.length === 1, JSON.stringify({ titles: settingsFolded.titles, icons: settingsFolded.icons }));

await page.evaluate(() => { document.querySelectorAll("main details").forEach((node) => { node.open = true; }); });
await page.waitForTimeout(700);
const settingsExpanded = await page.evaluate(() => {
  const main = document.querySelector("main");
  const rows = [...main.querySelectorAll("details > div > div")].filter((node) => node.getBoundingClientRect().height > 0);
  const controls = [...main.querySelectorAll("button, select, input, textarea, [role=switch]")].filter((node) => node.offsetParent !== null && !node.closest("header"));
  return {
    rowHeights: [...new Set(rows.map((node) => Math.round(node.getBoundingClientRect().height)))].sort((a, b) => a - b),
    rowBorders: [...new Set(rows.map((node) => getComputedStyle(node).borderTopWidth))],
    smallControls: controls.filter((node) => Math.min(node.getBoundingClientRect().width, node.getBoundingClientRect().height) < 40).length,
    switches: main.querySelectorAll("[role=switch]").length,
    switchHeights: [...new Set([...main.querySelectorAll("[role=switch]")].map((node) => Math.round(node.getBoundingClientRect().height)))],
    nativeCheckboxes: main.querySelectorAll('input[type="checkbox"]').length,
    selectClasses: [...new Set([...main.querySelectorAll("select")].map((node) => node.className.includes("min-w-32") ? "settings" : "hand-written"))],
  };
});
check("设置行最小高度 56px 且分隔为发丝线", settingsExpanded.rowHeights[0] === 56 && settingsExpanded.rowBorders.sort().join(",") === "0px,1px", JSON.stringify({ heights: settingsExpanded.rowHeights.slice(0, 4), border: settingsExpanded.rowBorders }));
check("设置页没有 <40px 的可点控件", settingsExpanded.smallControls === 0, "small=" + settingsExpanded.smallControls);
check("勾选框已换成 role=switch(44px)", settingsExpanded.nativeCheckboxes === 0 && settingsExpanded.switches >= 2 && settingsExpanded.switchHeights.every((height) => height >= 44), JSON.stringify({ checkboxes: settingsExpanded.nativeCheckboxes, switches: settingsExpanded.switches, heights: settingsExpanded.switchHeights }));
check("设置页下拉全部来自 SettingsSelect", settingsExpanded.selectClasses.length === 1 && settingsExpanded.selectClasses[0] === "settings", JSON.stringify(settingsExpanded.selectClasses));
check("设置页布局能展开", (await page.locator("main details[open]").count()) === 8, "open=" + (await page.locator("main details[open]").count()));

// 390 手机上不能横向溢出(展开态最容易撑破) —— 响应式由 CSS 决定,直接切视口测。
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
const settingsMobile = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(700);
check("设置页 390 无横向溢出(全部展开)", settingsMobile.scroll <= 390, JSON.stringify(settingsMobile));
await page.locator('[aria-label="概览"]:visible').first().click();
await page.waitForTimeout(1200);
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
