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
const USER = PROBE_USER;
const PASS = PROBE_PASS;

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const scan = async (page, label) => {
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("svg").forEach((svg) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // The slot is the svg's direct parent: the box meant to hold the glyph.
      // Only slots that visually frame the icon are meaningful to measure.
      const slot = svg.parentElement;
      if (!slot) return;
      const slotStyle = getComputedStyle(slot);
      const slotBox = slot.getBoundingClientRect();
      if (!slotBox.width || !slotBox.height) return;
      const isGrid = slotStyle.display.includes("grid");
      const isFlexRow =
        slotStyle.display.includes("flex") && !slotStyle.flexDirection.startsWith("column");
      // A slot frames the icon when it is a grid, or a row flex whose box is
      // close to the glyph size (an icon chip), not a wide text row.
      const slotIsChip =
        isGrid ||
        (isFlexRow &&
          slotBox.width <= rect.width + 40 &&
          slotBox.height <= rect.height + 40);
      if (!slotIsChip) return;
      // A chip that also carries a label lays the glyph out on the text flow,
      // so only a glyph-only slot can be judged by center alignment.
      const slotHasText = (slot.textContent || "").trim().length > 0;
      if (slotHasText) return;
      const host = svg.closest("button, a, [role='button'], label, summary, div, span") || slot;
      const box = slotBox;
      const dx = rect.left + rect.width / 2 - (box.left + box.width / 2);
      const dy = rect.top + rect.height / 2 - (box.top + box.height / 2);
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
        out.push({
          tag: host.tagName.toLowerCase(),
          cls: (host.getAttribute("class") || "").slice(0, 90),
          aria: host.getAttribute("aria-label") || host.textContent?.trim().slice(0, 20) || "",
          slotCls: (slot.getAttribute("class") || "").slice(0, 70),
          dx: Math.round(dx * 10) / 10,
          dy: Math.round(dy * 10) / 10,
          hostW: Math.round(box.width),
          hostH: Math.round(box.height),
        });
      }
    });
    return out;
  });
  const total = await page.locator("svg").count();
  console.log(`\n===== ${label}: ${bad.length} misaligned of ${total} svg =====`);
  for (const b of bad.slice(0, 20)) {
    console.log(
      `  dx=${b.dx} dy=${b.dy} slot=${b.hostW}x${b.hostH} aria="${b.aria}" slotCls=${b.slotCls}`,
    );
  }
  return bad.length;
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
}
  await assertSignedIn(page);

let total = 0;

const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  total += await scan(page, "welcome-modal");
  await skip.first().click();
  await page.waitForTimeout(700);
}

const views = ["概览", "物品", "任务", "空间", "盘点", "设置"];
for (const view of views) {
  const target = page.locator(`[aria-label="${view}"]`).first();
  if (!(await target.count())) continue;
  await target.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  total += await scan(page, "view:" + view);
}

const modals = [
  ["[aria-label=\"查看提醒\"]", "notifications"],
  ["[aria-label=\"打开归物助手\"]", "ai-chat"],
  ["button:has-text(\"录入物品\")", "item-modal"],
  ["[aria-label=\"进入家庭盘点\"]", "audit"],
  ["[aria-label=\"打开回收站\"]", "recycle-bin"],
];
for (const [selector, label] of modals) {
  const btn = page.locator(selector).first();
  if (!(await btn.count())) continue;
  await btn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1100);
  total += await scan(page, "modal:" + label);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
}

await context.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mobile.newPage();
await mpage.goto(BASE, { waitUntil: "domcontentloaded" });
await mpage.waitForTimeout(1500);
if (await mpage.locator("#auth-username").count()) {
  await mpage.fill("#auth-username", USER);
  await mpage.fill("#auth-password", PASS);
  await mpage.click('button[type="submit"]');
  await mpage.waitForTimeout(2500);
}
  await assertSignedIn(mpage);
const mskip = mpage.locator('[aria-label="暂时跳过欢迎引导"]');
if (await mskip.count()) {
  await mskip.first().click();
  await mpage.waitForTimeout(700);
}
total += await scan(mpage, "mobile:dashboard");
await mobile.close();

await browser.close();
console.log("\nTOTAL misaligned svg:", total);
