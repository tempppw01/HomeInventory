import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PROBE_USER = process.env.PROBE_USER || "admin";
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_PASS) {
  throw new Error("set PROBE_PASS to the account password before running this script");
}

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const overlays = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("div")].filter((node) => {
        const style = getComputedStyle(node);
        return (
          style.position === "fixed" &&
          style.inset === "0px" &&
          node.getBoundingClientRect().width > 300
        );
      }).length,
  );

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", PROBE_USER);
  await page.fill("#auth-password", PROBE_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2800);
}
if (await page.locator("#auth-username").count()) {
  throw new Error("still on the sign-in form: the login request was rejected");
}
const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(800);
}

let failures = 0;
const record = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
};

const cases = [
  ["录入物品", 'button:has-text("录入物品")'],
  ["提醒中心", '[aria-label="查看提醒"]'],
  ["回收站", '[aria-label="回收站"]'],
];

for (const [label, selector] of cases) {
  const trigger = page.locator(selector).first();
  if (!(await trigger.count())) {
    record(label, false, "trigger not found");
    continue;
  }
  await trigger.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const opened = await overlays();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  const hasDialogRole = (await dialog.count()) > 0;
  const closeVisible = await page
    .locator('button[aria-label^="关闭"]:visible')
    .first()
    .isVisible()
    .catch(() => false);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  const afterEscape = await overlays();

  record(`${label} 打开`, opened > 0, `overlays=${opened}`);
  record(`${label} 对话框语义`, hasDialogRole);
  record(`${label} 关闭按钮可见`, closeVisible);
  record(`${label} Esc 关闭`, afterEscape < opened, `${opened} -> ${afterEscape}`);
}

await context.close();
await browser.close();
console.log(failures ? `\n${failures} 项未通过` : "\n全部通过");
process.exit(failures ? 1 : 0);
