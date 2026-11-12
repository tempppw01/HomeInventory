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
const USER = PROBE_USER;
const PASS = PROBE_PASS;
const TAG = process.env.SHOT_TAG || "before";
const OUT = "output/playwright";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const shoot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
  console.log(`${OUT}/${TAG}-${name}.png`);
};

const run = async (viewport, prefix) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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

  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
  if (await skip.count()) {
    await shoot(page, `${prefix}-welcome`);
    await skip.first().click();
    await page.waitForTimeout(700);
  }

  await shoot(page, `${prefix}-dashboard`);

  const nav = async (label) => {
    // On mobile the desktop sidebar stays mounted but hidden, so pick the
    // entry that is actually on screen. The mobile bar labels its buttons with
    // visible text instead of aria-label.
    const ariaVisible = page.locator(`[aria-label="${label}"]:visible`).first();
    const mobileBar = page.locator(`nav[aria-label="移动端主导航"] button:has-text("${label}")`).first();
    const target = (await ariaVisible.count())
      ? ariaVisible
      : (await mobileBar.count())
        ? mobileBar
        : page.locator(`[aria-label="${label}"]`).first();
    if (!(await target.count())) return false;
    await target.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return true;
  };

  if (await nav("物品")) await shoot(page, `${prefix}-items`);
  if (await nav("空间")) await shoot(page, `${prefix}-locations`);
  if (await nav("任务")) await shoot(page, `${prefix}-tasks`);
  if (await nav("设置")) await shoot(page, `${prefix}-settings`);

  const chat = page.locator('[aria-label="打开归物助手"]').first();
  if (await chat.count()) {
    await chat.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shoot(page, `${prefix}-chat`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  await context.close();
};

await run({ width: 1440, height: 900 }, "desktop");
await run({ width: 390, height: 844 }, "mobile");

await browser.close();
