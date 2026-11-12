import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PROBE_USER = process.env.PROBE_USER || "admin";
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_PASS) {
  throw new Error("set PROBE_PASS to the account password before running this script");
}

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const collect = (page) =>
  page.evaluate(() => {
    const issues = [];
    // Audit only the surface the user is currently on: the topmost dialog when
    // one is open, otherwise the page itself.
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
    const scope = dialogs.length ? dialogs[dialogs.length - 1] : document.body;

    // 1. Text that is clipped without opting into truncation.
    scope.querySelectorAll("*").forEach((el) => {
      if (el.children.length) return;
      const text = (el.textContent || "").trim();
      if (!text) return;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      const clips = style.overflowX === "hidden" || style.overflow === "hidden";
      if (!clips) return;
      const cls = el.getAttribute("class") || "";
      if (cls.includes("truncate") || cls.includes("sr-only")) return;
      if (el.scrollWidth > el.clientWidth + 1) {
        issues.push({
          kind: "clipped-text",
          detail: text.slice(0, 40),
          cls: (el.getAttribute("class") || "").slice(0, 60),
          over: el.scrollWidth - el.clientWidth,
        });
      }
    });

    // 2. Controls whose centre is actually covered by another control.
    const controls = [...scope.querySelectorAll("button, a, input, select, summary")].filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });
    for (const el of controls) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      // Hit test without mutating the DOM: if the centre resolves to this
      // control (or something inside it) the control is on top and clickable.
      const hit = document.elementFromPoint(cx, cy);
      if (!hit) continue;
      if (hit === el || el.contains(hit)) continue;
      const blocker = hit.closest("button, a, input, select, summary");
      if (!blocker || blocker === el || el.contains(blocker) || blocker.contains(el)) continue;
      const label = (node) =>
        (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || node.tagName).trim().slice(0, 20);
      // An inset adornment (icon button inside its own field) is intentional.
      if (el.closest("label") && el.closest("label") === blocker.closest("label")) continue;
      if (issues.some((entry) => entry.kind === "control-obstructed" && entry.detail.startsWith(label(el)))) continue;
      issues.push({
        kind: "control-obstructed",
        detail: `${label(el)} covered by ${label(blocker)}`,
        cls: (el.getAttribute("class") || "").slice(0, 50),
        over: 0,
      });
    }

    // 3. Horizontal page overflow.
    if (!dialogs.length && document.documentElement.scrollWidth > window.innerWidth + 1) {
      issues.push({
        kind: "page-overflow-x",
        detail: `${document.documentElement.scrollWidth} > ${window.innerWidth}`,
        cls: "",
        over: document.documentElement.scrollWidth - window.innerWidth,
      });
    }

    return issues;
  });

const report = async (page, label) => {
  const issues = await collect(page);
  if (!issues.length) {
    console.log(`ok   ${label}`);
    return 0;
  }
  console.log(`FAIL ${label}: ${issues.length}`);
  for (const issue of issues.slice(0, 8)) {
    console.log(`     ${issue.kind} +${issue.over} "${issue.detail}" ${issue.cls}`);
  }
  return issues.length;
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => consoleErrors.push("pageerror " + String(e).slice(0, 160)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", PROBE_USER);
  await page.fill("#auth-password", PROBE_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2800);
}
if (await page.locator("#auth-username").count()) throw new Error("login rejected");
const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(700);
}

let total = 0;
for (const view of ["概览", "物品", "任务", "空间", "盘点", "设置"]) {
  const nav = page.locator(`[aria-label="${view}"]:visible`).first();
  if (!(await nav.count())) continue;
  await nav.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2600);
  total += await report(page, `view:${view}`);
}

// Settings sub-panels.
for (const summary of ["账号与家庭成员", "AI 模型与识别", "数据安全与家庭成员", "图片存储", "数据与部署"]) {
  const toggle = page.locator(`summary:has-text("${summary}")`).first();
  if (!(await toggle.count())) continue;
  await toggle.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1800);
  total += await report(page, `settings:${summary}`);
}

// Recycle bin and QR modal from the header/sidebar.
const recycle = page.locator('[aria-label="回收站"]').first();
if (await recycle.count()) {
  await recycle.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  total += await report(page, "modal:recycle-bin");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
}

// QR modal, then its print studio.
await page.locator('[aria-label="物品"]:visible').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1400);
const qr = page.locator('[aria-label="显示二维码"]').first();
if (await qr.count()) {
  await qr.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1100);
  total += await report(page, "modal:qr");
  const print = page.locator('button:has-text("打印")').last();
  if (await print.count()) {
    await print.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1400);
    total += await report(page, "modal:print-studio");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  } else {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
}

// Batch edit requires a selection.
const selectButtons = page.locator('[aria-label="选择物品"]');
if ((await selectButtons.count()) >= 2) {
  await selectButtons.nth(0).click({ timeout: 6000 }).catch(() => {});
  await selectButtons.nth(1).click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(800);
  const bulk = page.locator('button:has-text("批量编辑")').first();
  if (await bulk.count()) {
    await bulk.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1100);
    total += await report(page, "modal:batch-edit");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
}

// Item detail route.
const detailLink = page.locator("button.truncate").first();
if (await detailLink.count()) {
  await detailLink.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2200);
  if (page.url().includes("/items/")) {
    total += await report(page, "route:item-detail");
    await page.screenshot({ path: "output/playwright/audit-item-detail.png", animations: "disabled", timeout: 20000 }).catch(() => {});
  }
}

console.log(`\n=== console errors ===`);
console.log(consoleErrors.length ? consoleErrors.slice(0, 10).join("\n") : "(none)");
console.log(`\nTOTAL layout issues: ${total}`);

await context.close();
await browser.close();

