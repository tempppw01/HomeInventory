import { chromium } from "playwright";

const PROBE_USER = process.env.PROBE_USER || "admin";
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_PASS) {
  throw new Error("set PROBE_PASS to the account password before running this script");
}

const assertSignedIn = async (target) => {
  if (await target.locator("#auth-username").count()) {
    throw new Error("still on the sign-in form: the login request was rejected");
  }
  if (!(await target.locator('[aria-label="概览"]').count())) {
    throw new Error("app shell did not render after sign-in");
  }
};
const BASE = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const scan = async (page, label) => {
  const bad = await page.evaluate(() => {
    const out = [];
    // Icons that are adornments inside a bordered field.
    document.querySelectorAll(".input-icon, .input-icon-end").forEach((svg) => {
      const field = svg.closest("label, div");
      if (!field) return;
      const box = field.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const mid = box.top + box.height / 2;
      if (Math.abs(cy - mid) > 1.5) {
        out.push({
          kind: "field-adornment",
          dx: Math.round((cx - (box.left + box.width / 2)) * 10) / 10,
          dy: Math.round((cy - mid) * 10) / 10,
          cls: (svg.getAttribute("class") || "").slice(0, 60),
          parentCls: (svg.parentElement?.getAttribute("class") || "").slice(0, 60),
          box: `${Math.round(box.width)}x${Math.round(box.height)}`,
        });
      }
    });
    // Native selects render their own arrow; verify the control is not
    // visually clipped or vertically offset by extra padding.
    document.querySelectorAll("select").forEach((sel) => {
      const style = getComputedStyle(sel);
      const lineHeight = parseFloat(style.lineHeight);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const contentHeight = sel.clientHeight - paddingY;
      if (Number.isFinite(lineHeight) && Math.abs(contentHeight - lineHeight) > 2.5) {
        out.push({
          kind: "select-misaligned",
          dx: 0,
          dy: Math.round((contentHeight - lineHeight) * 10) / 10,
          cls: (sel.getAttribute("class") || "").slice(0, 60),
          parentCls: "",
          box: `${Math.round(sel.getBoundingClientRect().width)}x${Math.round(sel.getBoundingClientRect().height)}`,
        });
      }
    });
    return out;
  });
  console.log(`\n===== ${label}: ${bad.length} issues =====`);
  for (const b of bad.slice(0, 20)) {
    console.log(`  ${b.kind} dx=${b.dx} dy=${b.dy} box=${b.box} cls=${b.cls} parent=${b.parentCls}`);
  }
  return bad.length;
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", PROBE_USER);
  await page.fill("#auth-password", PROBE_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
}
  await assertSignedIn(page);
const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(700);
}

let total = 0;
for (const view of ["概览", "物品", "任务", "空间", "盘点", "设置"]) {
  const target = page.locator(`[aria-label="${view}"]`).first();
  if (!(await target.count())) continue;
  await target.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  total += await scan(page, "view:" + view);
}

const itemBtn = page.locator('button:has-text("录入物品")').first();
if (await itemBtn.count()) {
  await itemBtn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1100);
  total += await scan(page, "modal:item-modal");
}

await browser.close();
console.log("\nTOTAL box icon issues:", total);
