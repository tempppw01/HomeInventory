import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe` });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(process.env.BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.fill("#auth-username", "admin");
await page.fill("#auth-password", process.env.PROBE_PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(2800);
const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(700); }
await page.locator('[aria-label="设置"]:visible').first().click();
await page.waitForTimeout(2000);
await page.locator('summary:has-text("账号与家庭成员")').first().click().catch(() => {});
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const kick = [...document.querySelectorAll("button")].find((n) => (n.getAttribute("title") || "").includes("踢出") || (n.textContent || "").trim() === "踢出");
  const tools = [...document.querySelectorAll("summary")].find((n) => (n.textContent || "").includes("数据安全与家庭成员"));
  const kr = kick ? kick.getBoundingClientRect() : null;
  const tr = tools ? tools.getBoundingClientRect() : null;
  let hit = null;
  if (kr) {
    const h = document.elementFromPoint(kr.left + kr.width / 2, kr.top + kr.height / 2);
    hit = h ? h.tagName + " | " + (h.textContent || "").trim().slice(0, 40) : null;
  }
  return {
    kick: kr ? { x: Math.round(kr.x), y: Math.round(kr.y), w: Math.round(kr.width), h: Math.round(kr.height) } : null,
    tools: tr ? { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) } : null,
    hit,
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: "output/playwright/audit-settings-expanded.png", animations: "disabled", timeout: 20000 }).catch(() => {});
await browser.close();
