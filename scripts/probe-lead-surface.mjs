// Focused checks: phantom overlap on settings, request volume per view,
// real keyboard focus ring, welcome-modal persistence.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const PASS = process.env.PROBE_PASS;
const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const requests = [];
page.on("request", (r) => {
  if (r.url().includes("/api/")) requests.push({ url: r.url().replace(BASE, ""), at: Date.now() });
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.fill("#auth-username", "admin");
await page.fill("#auth-password", PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(2600);

const welcomeVisible = await page.locator('[aria-label="暂时跳过欢迎引导"]').count();
console.log("welcome modal on fresh context:", welcomeVisible ? "shown" : "absent");

// Reload with the same context: does the welcome modal stay dismissed?
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
console.log("welcome modal after reload (same storage):", (await page.locator('[aria-label="暂时跳过欢迎引导"]').count()) ? "shown again" : "stays dismissed");

const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(700);
}

// ---- phantom overlap on settings
await page.locator('[aria-label="设置"]:visible').first().click();
await page.waitForTimeout(1800);
const phantom = await page.evaluate(() => {
  const target = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("踢出此设备"));
  if (!target) return { found: false };
  const chain = [];
  let node = target;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    chain.push({
      tag: node.tagName.toLowerCase(),
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      overflow: s.overflow,
      h: Math.round(r.height),
      w: Math.round(r.width),
      cls: (node.className || "").toString().slice(0, 60),
      inClosedDetails: node.tagName === "DETAILS" ? !node.open : undefined,
    });
    node = node.parentElement;
  }
  const rect = target.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    found: true,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    hitTag: hit?.tagName,
    hitText: (hit?.textContent || "").trim().slice(0, 40),
    chain: chain.slice(0, 10),
  };
});
console.log("\n--- 踢出此设备 phantom check ---");
console.log(JSON.stringify(phantom, null, 2));

// ---- request volume per view switch
await page.locator('[aria-label="概览"]:visible').first().click();
await page.waitForTimeout(2000);
const counts = new Map();
const mark = () => {
  const now = Date.now();
  for (const r of requests.splice(0)) {
    const bucket = `${r.url.split("?")[0]}`;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
    void now;
  }
};
mark();
for (const view of ["物品", "任务", "空间", "盘点", "设置", "概览", "物品", "概览"]) {
  await page.locator(`[aria-label="${view}"]:visible`).first().click();
  await page.waitForTimeout(2200);
}
mark();
console.log("\n--- API requests during 8 view switches ---");
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(3)} ${k}`);

// ---- real keyboard focus ring
await page.locator('[aria-label="物品"]:visible').first().click();
await page.waitForTimeout(1500);
await page.evaluate(() => document.body.focus());
await page.keyboard.press("Tab");
const rings = [];
for (let i = 0; i < 12; i += 1) {
  const info = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    const s = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    return {
      tag: a.tagName.toLowerCase(),
      label: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 22),
      outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`.slice(0, 60),
      boxShadow: s.boxShadow.slice(0, 60),
      ring: s.outlineStyle !== "none" || (s.boxShadow !== "none" && s.boxShadow.includes("rgb")),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  if (info) rings.push(info);
  await page.keyboard.press("Tab");
}
console.log("\n--- tab order (first 12) from top of items view ---");
for (const r of rings) console.log(`  ${r.ring ? "ring " : "NONE "} <${r.tag}> ${r.w}x${r.h} "${r.label}" outline=${r.outline}`);

// ---- sidebar / collapsed
await browser.close();
