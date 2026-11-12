import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const PROBE_USER = process.env.PROBE_USER || "admin";
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_PASS) {
  throw new Error("set PROBE_PASS to the account password before running this script");
}

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const errors = [];
const failedRequests = [];
const requestCounts = new Map();

const attach = (page, tag) => {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`[${tag}] ${message.text().slice(0, 220)}`);
  });
  page.on("pageerror", (error) => errors.push(`[${tag}] pageerror: ${String(error).slice(0, 220)}`));
  page.on("response", (response) => {
    const url = response.url().replace(BASE, "");
    if (url.startsWith("/api/")) {
      const key = url.split("?")[0];
      requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
    }
    if (response.status() >= 400) failedRequests.push(`[${tag}] ${response.status()} ${url}`);
  });
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
attach(page, "desktop");

const assertSignedIn = async (target) => {
  if (await target.locator("#auth-username").count()) {
    throw new Error("still on the sign-in form: the login request was rejected");
  }
  if (!(await target.locator('[aria-label="概览"]').count())) {
    throw new Error("app shell did not render after sign-in");
  }
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", PROBE_USER);
  await page.fill("#auth-password", PROBE_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2800);
}
await assertSignedIn(page);

const snapshot = () => new Map(requestCounts);
const diff = (before, after) => {
  const out = [];
  for (const [key, value] of after.entries()) {
    const delta = value - (before.get(key) || 0);
    if (delta > 0) out.push([key, delta]);
  }
  return out.sort((a, b) => b[1] - a[1]);
};

// Walk every primary view and let data settle so request patterns show up.
for (const view of ["概览", "物品", "任务", "空间", "盘点", "设置"]) {
  const target = page.locator(`[aria-label="${view}"]`).first();
  if (!(await target.count())) {
    console.log("missing view:", view);
    continue;
  }
  const before = snapshot();
  await target.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const top = diff(before, snapshot()).slice(0, 8);
  console.log(`${view}: ${top.length ? top.map(([k, v]) => `${k} x${v}`).join(", ") : "(no new requests)"}`);
}

console.log("\n=== console errors ===");
console.log(errors.length ? errors.slice(0, 30).join("\n") : "(none)");
console.log("\n=== failed requests ===");
console.log(failedRequests.length ? failedRequests.slice(0, 30).join("\n") : "(none)");

console.log("\n=== total requests ===");
for (const [key, count] of [...requestCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${count.toString().padStart(4)} ${key}`);
}

await browser.close();
