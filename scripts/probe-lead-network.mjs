// Per-interaction network accounting: which API calls does each view switch fire?
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const PASS = process.env.PROBE_PASS;
const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let bucket = [];
const all = [];
page.on("request", (r) => {
  if (!r.url().includes("/api/")) return;
  const key = r.url().replace(BASE, "").split("?")[0] + " " + r.method();
  bucket.push(key);
  all.push(key);
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.fill("#auth-username", "admin");
await page.fill("#auth-password", PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(700);
}

const step = async (label, fn) => {
  await page.waitForTimeout(500);
  bucket = [];
  await fn();
  await page.waitForTimeout(2600);
  const tally = new Map();
  for (const k of bucket) tally.set(k, (tally.get(k) || 0) + 1);
  console.log(`${label}: ${tally.size ? [...tally].map(([k, v]) => `${k}${v > 1 ? ` x${v}` : ""}`).join(", ") : "(none)"}`);
};

const nav = (view) => page.locator(`[aria-label="${view}"]:visible`).first().click();

for (const view of ["物品", "任务", "空间", "盘点", "设置", "概览", "物品", "概览", "设置", "概览"]) {
  await step(`nav ${view}`, () => nav(view));
}

await step("打开录入物品弹窗", async () => {
  await page.locator('button[aria-label="录入物品"]:visible').first().click();
});
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

await step("打开提醒", () => page.locator('button[aria-label="查看提醒"]:visible').first().click());
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

await step("打开回收站", () => page.locator('button[aria-label="回收站"]:visible').first().click());
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

await step("打开 AI 助手", () => page.locator('button[aria-label="打开归物助手"]:visible').first().click());
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// Long session: idle for 30s on the dashboard to spot polling.
bucket = [];
await page.waitForTimeout(30000);
console.log(`idle 30s on dashboard: ${bucket.length ? [...new Set(bucket)].map((k) => `${k} x${bucket.filter((b) => b === k).length}`).join(", ") : "(no polling)"}`);

const tally = new Map();
for (const k of all) tally.set(k, (tally.get(k) || 0) + 1);
console.log("\n--- session total ---");
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(3)} ${k}`);

await browser.close();
