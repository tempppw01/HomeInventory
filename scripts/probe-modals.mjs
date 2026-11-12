import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

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
const OUT = "output/playwright";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

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
  await page.waitForTimeout(600);
}

const scan = () =>
  page.evaluate(() => {
    const out = [];
    document.querySelectorAll("button, a[role='button'], [role='button']").forEach((button) => {
      const text = (button.textContent || "").trim();
      if (text.length > 0) return;
      const svgs = button.querySelectorAll(":scope > svg");
      if (svgs.length !== 1) return;
      const svg = svgs[0];
      const box = button.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return;
      const sbox = svg.getBoundingClientRect();
      if (sbox.width === 0 || sbox.height === 0) return;
      const dx = sbox.left + sbox.width / 2 - (box.left + box.width / 2);
      const dy = sbox.top + sbox.height / 2 - (box.top + box.height / 2);
      const style = getComputedStyle(button);
      out.push({
        label: button.getAttribute("aria-label") || button.getAttribute("title") || "(none)",
        cls: button.className.toString().slice(0, 90),
        w: Math.round(box.width * 10) / 10,
        h: Math.round(box.height * 10) / 10,
        dx: Math.round(dx * 10) / 10,
        dy: Math.round(dy * 10) / 10,
        minHeight: style.minHeight,
        display: style.display,
      });
    });
    return out;
  });

const nav = async (label) => {
  const target = page.locator(`[aria-label="${label}"]`).first();
  if (await target.count()) {
    await target.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }
  return false;
};

const clickText = async (text) => {
  const target = page.locator(`button:has-text("${text}")`).first();
  if (!(await target.count())) return false;
  await target.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  return true;
};

const closeOverlay = async () => {
  const close = page.locator('[aria-label="暂时跳过欢迎引导"]').first();
  if (await close.count()) {
    await close.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
};

// Open each modal by clicking a trigger, then scan inside it.
const modals = [
  { name: "welcome", goto: async () => {
      await page.evaluate(() => window.localStorage.clear());
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    } },
  { name: "notifications", goto: () => nav("查看提醒") },
  { name: "ai-chat", goto: () => nav("打开归物助手") },
  { name: "item-modal", goto: () => clickText("录入物品") },
  { name: "settings", goto: async () => {
      await nav("设置");
      return true;
    } },
  { name: "recycle-bin", goto: async () => {
      await nav("设置");
      return clickText("回收站");
    } },
  { name: "audit", goto: async () => {
      await nav("设置");
      return clickText("盘点");
    } },
];

const seen = new Set();
let total = 0;
let bad = 0;
for (const modal of modals) {
  try {
    const ok = await modal.goto();
    if (ok === false) {
      console.log(`skip ${modal.name}: trigger not found`);
      continue;
    }
    await page.waitForTimeout(700);
  } catch (error) {
    console.log(`skip ${modal.name}: ${error.message}`);
    continue;
  }
  const rows = await scan();
  const flagged = rows.filter((row) => Math.abs(row.dx) > 0.6 || Math.abs(row.dy) > 0.6);
  total += rows.length;
  bad += flagged.length;
  console.log(`\n===== ${modal.name}: ${rows.length} icon-only buttons, ${flagged.length} off-center =====`);
  for (const row of flagged) {
    const key = `${row.label}|${row.cls}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(JSON.stringify(row));
  }
  await closeOverlay();
}

console.log(`\nTOTAL ${total} icon-only buttons, ${bad} off-center`);
await browser.close();
