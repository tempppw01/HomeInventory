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
    document.querySelectorAll("input, select, textarea").forEach((field) => {
      const fieldBox = field.getBoundingClientRect();
      if (fieldBox.height < 8) return;
      const wrapper = field.parentElement;
      if (!wrapper) return;
      const style = getComputedStyle(wrapper);
      if (style.position !== "relative" && style.position !== "absolute") return;
      wrapper.querySelectorAll(":scope > svg, :scope > span > svg").forEach((svg) => {
        const sbox = svg.getBoundingClientRect();
        if (sbox.width === 0 || sbox.height === 0) return;
        const dx = sbox.left + sbox.width / 2 - (fieldBox.left + fieldBox.width / 2);
        const dy = sbox.top + sbox.height / 2 - (fieldBox.top + fieldBox.height / 2);
        out.push({
          id: field.id || field.getAttribute("aria-label") || field.className.toString().slice(0, 40),
          fieldH: Math.round(fieldBox.height * 10) / 10,
          iconH: Math.round(sbox.height * 10) / 10,
          dy: Math.round(dy * 10) / 10,
          iconTop: Math.round(sbox.top - fieldBox.top * 1 * 0 + fieldBox.top * 0 - fieldBox.top),
          iconClass: svg.getAttribute("class") || "(none)",
        });
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

const views = [
  { name: "dashboard", goto: async () => {} },
  { name: "items", goto: () => nav("物品") },
  { name: "settings", goto: () => nav("设置") },
];

for (const view of views) {
  try {
    await view.goto();
    await page.waitForTimeout(700);
  } catch (error) {
    console.log(`skip ${view.name}: ${error.message}`);
    continue;
  }
  const rows = await scan();
  console.log(`\n===== ${view.name}: ${rows.length} field icons =====`);
  rows.forEach((row) => console.log(JSON.stringify(row)));
}

await browser.close();
