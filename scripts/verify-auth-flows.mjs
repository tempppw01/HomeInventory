import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const OUT = "output/playwright";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});
const results = [];
const record = (name, data) => results.push({ name, ...data });
let setupPassword = "";

// ---------- SETUP FLOW ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  const heading = await page.textContent("h1");
  const hasStrength = await page.locator("text=强度").count();
  const hasGenerate = await page.locator("text=生成强密码").count();
  await page.screenshot({ path: `${OUT}/auth-setup-desktop.png` });
  record("setup-screen", { heading, hasStrengthMeter: hasStrength > 0, hasGenerateButton: hasGenerate > 0, errors });

  // Generate a strong password and confirm the meter responds.
  await page.click("text=生成强密码");
  const generated = await page.inputValue("#auth-password");
  setupPassword = generated;
  const strengthLabel = await page.locator(".ds-field-hint").last().textContent();
  await page.screenshot({ path: `${OUT}/auth-setup-generated.png` });
  record("setup-generate", { length: generated.length, hasMixedCase: /[a-z]/.test(generated) && /[A-Z]/.test(generated), hasDigit: /\d/.test(generated), hasSymbol: /[^A-Za-z0-9]/.test(generated) });

  await page.fill("#auth-username", "admin");
  await page.fill("#auth-display-name", "管理员");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const afterSetup = page.url();
  const loggedIn = await page.locator("text=欢迎回家").count();
  await page.screenshot({ path: `${OUT}/auth-after-setup.png` });
  record("setup-submit", { url: afterSetup, stillOnAuthScreen: loggedIn > 0, errors });

  await context.close();
}

// ---------- LOGIN FLOW (remember off / on) ----------
for (const remember of [false, true]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill("#auth-username", "admin");
  await page.fill("#auth-password", setupPassword);
  if (!remember) await page.uncheck('input[type="checkbox"]');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "home_inventory_session");
  const loggedIn = await page.locator("text=欢迎回家").count();
  record(`login-remember-${remember ? "on" : "off"}`, {
    loggedIn: loggedIn === 0,
    hasSessionCookie: Boolean(session),
    persistent: session ? session.expires !== -1 : null,
    expires: session ? new Date(session.expires * 1000).toISOString() : null,
  });
  await context.close();
}

// ---------- WRONG PASSWORD ERROR SURFACE ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill("#auth-username", "admin");
  await page.fill("#auth-password", "WrongPassword1!");
  await page.click('button[type="submit"]');
  const alertLocator = page.locator('[role="alert"]');
  await alertLocator.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  const alert = await alertLocator.textContent().catch(() => null);
  await page.screenshot({ path: `${OUT}/auth-login-error.png` });
  record("login-error-banner", { message: alert });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
