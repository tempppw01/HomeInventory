import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const PASSWORD = process.env.ADMIN_PASSWORD;
const OUT = "output/playwright";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});
const results = [];
const record = (name, data) => results.push({ name, ...data });

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const dismissWelcome = async (target) => {
  const skip = target.locator('button[aria-label="暂时跳过欢迎引导"]');
  if (await skip.count()) {
    await skip.first().click();
    await target.waitForTimeout(600);
  }
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill("#auth-username", "admin");
await page.fill("#auth-password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);
await dismissWelcome(page);

// Navigate to settings and open the account section.
await page.click('button[aria-label="设置"]');
await page.waitForTimeout(1200);
await page.click("summary:has-text('账号与家庭成员')");
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/account-settings-open.png`, fullPage: false });

const hasDetails = await page.locator("summary:has-text('账号与家庭成员')").count();
record("account-panel", { opened: hasDetails > 0, errors: [...errors] });

// --- Create a member account ---
await page.fill("#new-username", "xiaoming");
await page.fill("#new-display-name", "小明");
await page.click("text=生成强密码");
const generated = await page.inputValue("#new-password");
await page.screenshot({ path: `${OUT}/account-create-form.png` });
record("create-form", { generatedLength: generated.length, hasMixed: /[a-z]/.test(generated) && /[A-Z]/.test(generated) });

await page.click("button:has-text('创建账号')");
await page.waitForTimeout(2000);
const credentialsPanel = page.locator("section", { has: page.locator("text=账号已创建，请把登录信息交给") });
const credentialsVisible = await page.getByText("账号已创建").count();
const shownPassword = await page.locator("code").nth(1).textContent().catch(() => null);
await credentialsPanel.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/account-credentials-panel.png` });
record("create-submit", { credentialsPanelShown: credentialsVisible > 0, passwordShown: shownPassword, errors: [...errors] });

// Copy the password button should write to the clipboard.
await page.click('button[aria-label="复制初始密码"]');
await page.waitForTimeout(500);
const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
record("copy-credentials", { clipboardMatches: clipboard === shownPassword });

// --- Reset password modal ---
const memberRow = page.locator("select[aria-label='小明的账号权限']").locator("..");
await memberRow.getByRole("button", { name: "重置密码" }).click();
await page.waitForTimeout(700);
const dialogVisible = await page.locator('[role="dialog"]').count();
const dialogTitle = await page.locator("#reset-password-title").textContent().catch(() => null);
await page.screenshot({ path: `${OUT}/account-reset-modal.png` });
record("reset-modal", { visible: dialogVisible > 0, title: dialogTitle });

// Short password should be rejected inline.
await page.fill("#reset-password-input", "short");
await page.click("button:has-text('确认重置')");
await page.waitForTimeout(600);
const inlineError = await page.locator("#reset-password-error").textContent().catch(() => null);
await page.screenshot({ path: `${OUT}/account-reset-validation.png` });
record("reset-validation", { inlineError, dialogStillOpen: (await page.locator('[role="dialog"]').count()) > 0 });

// Valid password should succeed and close the dialog.
await page.fill("#reset-password-input", "BrandNewPass9!");
await page.click("button:has-text('确认重置')");
await page.waitForTimeout(2000);
record("reset-submit", { dialogClosed: (await page.locator('[role="dialog"]').count()) === 0, errors: [...errors] });

// The new member should be able to log in with the reset password.
const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const memberPage = await memberContext.newPage();
await memberPage.goto(BASE, { waitUntil: "domcontentloaded" });
await memberPage.fill("#auth-username", "xiaoming");
await memberPage.fill("#auth-password", "BrandNewPass9!");
await memberPage.click('button[type="submit"]');
await memberPage.waitForTimeout(2500);
await dismissWelcome(memberPage);
const memberLoggedIn = (await memberPage.locator("#auth-username").count()) === 0;
const memberError = await memberPage.locator("#auth-error").textContent().catch(() => null);
await memberPage.screenshot({ path: `${OUT}/account-member-login.png` });
record("member-login", { loggedIn: memberLoggedIn, error: memberError });
await memberContext.close();

await context.close();
await browser.close();
console.log(JSON.stringify(results, null, 2));
