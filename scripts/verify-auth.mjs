import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = "output/playwright";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH
    || `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});
const results = [];

async function shot(name, { width, height, theme = "light", prepare } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  if (theme === "dark") {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(300);
  }
  if (prepare) await prepare(page);

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

  // Detect elements that visually overlap the primary form column.
  const overlap = await page.evaluate(() => {
    const selectors = ["input", "button", "label", "h1"];
    const boxes = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        boxes.push({ selector, tag: element.tagName, rect, text: (element.textContent || "").slice(0, 24) });
      }
    }
    const hits = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.selector !== "input" || b.selector !== "input") continue;
        if (a.rect.left < b.rect.right && b.rect.left < a.rect.right && a.rect.top < b.rect.bottom && b.rect.top < a.rect.bottom) {
          hits.push(`${a.tag}(${a.text}) x ${b.tag}(${b.text})`);
        }
      }
    }
    const doc = document.documentElement;
    return {
      overlaps: hits,
      horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });

  results.push({ name, theme, width, height, ...overlap, consoleErrors: errors });
  await context.close();
  return page;
}

await shot("auth-login-desktop-light", { width: 1440, height: 900 });
await shot("auth-login-desktop-dark", { width: 1440, height: 900, theme: "dark" });
await shot("auth-login-mobile-light", { width: 390, height: 844 });
await shot("auth-login-mobile-dark", { width: 390, height: 844, theme: "dark" });
await shot("auth-login-tablet-light", { width: 820, height: 1180 });

// Password visibility toggle.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill("#auth-password", "SuperSecret123!");
const before = await page.getAttribute("#auth-password", "type");
await page.click('button[aria-label="显示密码"]');
const after = await page.getAttribute("#auth-password", "type");
await page.screenshot({ path: `${OUT}/auth-login-password-visible.png` });
results.push({ name: "password-toggle", before, after, passed: before === "password" && after === "text" });
await context.close();

// Inline validation on a bad username.
const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page2 = await context2.newPage();
await page2.goto(BASE, { waitUntil: "domcontentloaded" });
await page2.fill("#auth-username", "AB");
await page2.locator("#auth-username").blur();
await page2.waitForTimeout(300);
const invalidAttr = await page2.getAttribute("#auth-username", "aria-invalid");
await page2.screenshot({ path: `${OUT}/auth-login-validation.png` });
results.push({ name: "username-validation", invalidAttr });
await context2.close();

await browser.close();
console.log(JSON.stringify(results, null, 2));
