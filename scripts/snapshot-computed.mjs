import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

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
const TAG = process.env.SNAP_TAG || "before";
const OUT = "output";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const PROPS = [
  "display", "position", "width", "height", "minHeight", "minWidth", "maxWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color",
  "backgroundColor", "borderRadius", "borderTopWidth", "boxShadow",
  "gap", "alignItems", "justifyContent", "placeItems", "opacity", "overflow",
];

const collect = () =>
  page.evaluate((props) => {
    const pathOf = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1) {
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(">");
    };
    const out = {};
    document.querySelectorAll("*").forEach((el) => {
      const style = getComputedStyle(el);
      const record = {};
      for (const prop of props) record[prop] = style[prop];
      const cls = (el.getAttribute("class") || "").trim();
      const text = (el.textContent || "").trim().slice(0, 24);
      out[pathOf(el)] = { cls, text, style: record };
    });
    return out;
  }, PROPS);

const results = {};

const record = async (name) => {
  await page.waitForTimeout(700);
  results[name] = await collect();
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2800);
}
  await assertSignedIn(page);

// Welcome modal: reset the "seen" flag so the modal renders.
await page.evaluate(() => {
  Object.keys(localStorage).forEach((key) => {
    if (key.toLowerCase().includes("welcome")) localStorage.removeItem(key);
  });
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await record("desktop-welcome");

const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(600);
}
await record("desktop-dashboard");

// Items view
const itemsNav = page.getByRole("button", { name: "物品", exact: true }).first();
if (await itemsNav.count()) {
  await itemsNav.click();
  await page.waitForTimeout(900);
  await record("desktop-items");
}

// Settings view
const settingsNav = page.getByRole("button", { name: "设置", exact: true }).first();
if (await settingsNav.count()) {
  await settingsNav.click();
  await page.waitForTimeout(900);
  await record("desktop-settings");
}

// Item entry modal
const addItem = page.getByRole("button", { name: /录入物品/ }).first();
if (await addItem.count()) {
  await addItem.click();
  await page.waitForTimeout(900);
  await record("desktop-item-modal");
  const closeBtn = page.locator('button[aria-label="关闭录入物品"], button[aria-label^="关闭"]').last();
  if (await closeBtn.count()) {
    await closeBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

await context.close();

// Mobile viewport
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mpage = await mobile.newPage();
await mpage.goto(BASE, { waitUntil: "domcontentloaded" });
await mpage.waitForTimeout(1500);
if (await mpage.locator("#auth-username").count()) {
  await mpage.fill("#auth-username", USER);
  await mpage.fill("#auth-password", PASS);
  await mpage.click('button[type="submit"]');
  await mpage.waitForTimeout(2800);
}
  await assertSignedIn(mpage);
const mskip = mpage.locator('[aria-label="暂时跳过欢迎引导"]');
if (await mskip.count()) {
  await mskip.first().click();
  await mpage.waitForTimeout(500);
}
await mpage.waitForTimeout(700);
results["mobile-dashboard"] = await mpage.evaluate((props) => {
  const pathOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(">");
  };
  const out = {};
  document.querySelectorAll("*").forEach((el) => {
    const style = getComputedStyle(el);
    const record = {};
    for (const prop of props) record[prop] = style[prop];
    out[pathOf(el)] = { cls: (el.getAttribute("class") || "").trim(), text: (el.textContent || "").trim().slice(0, 24), style: record };
  });
  return out;
}, PROPS);

await mobile.close();
await browser.close();

await writeFile(`${OUT}/computed-${TAG}.json`, JSON.stringify(results, null, 1));
const counts = Object.entries(results).map(([k, v]) => `${k}=${Object.keys(v).length}`);
console.log(`saved ${OUT}/computed-${TAG}.json`, counts.join(" "));
