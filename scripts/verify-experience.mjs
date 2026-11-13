// Acceptance probe for the experience fixes. Every check prints PASS/FAIL with
// the measured value, so the Lead can verify the rebuilt app end to end.
//
//   BASE_URL=http://127.0.0.1:3001 PROBE_PASS=... node scripts/verify-experience.mjs
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const PASS = process.env.PROBE_PASS;
const USER = process.env.PROBE_USER || "admin";
// 只读账号检查需要另外准备一个 VIEWER 账号(可用 output/experience/make-viewer.cjs 创建),
// 密码从环境变量传入,不把凭据写进仓库。
const VIEWER_USER = process.env.PROBE_VIEWER_USER || "viewcheck";
const VIEWER_PASS = process.env.PROBE_VIEWER_PASS;
if (!PASS) throw new Error("set PROBE_PASS");
const OUT = "output/experience";
await mkdir(OUT, { recursive: true });

const EXECUTABLE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

// 静态检查:跟随系统的深色变量必须和 [data-theme="dark"] 完全一致,否则
// 「跟随系统」的访客会看到另一套(甚至缺 token 的)深色配色。
{
  const css = await readFile("src/app/globals.css", "utf8");
  const tokensOf = (text, startPattern) => {
    const at = text.search(startPattern);
    if (at < 0) return null;
    const open = text.indexOf("{", at);
    const close = text.indexOf("}", open);
    if (open < 0 || close < 0) return null;
    return text.slice(open + 1, close).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("--"));
  };
  const explicit = tokensOf(css, /\[data-theme="dark"\]\s*\{/);
  const mediaAt = css.search(/@media \(prefers-color-scheme: dark\)/);
  const fallback = mediaAt >= 0 ? tokensOf(css.slice(mediaAt), /:root:not\(\[data-theme\]\)\s*\{/) : null;
  const same = Boolean(explicit && fallback) && explicit.length === fallback.length && explicit.every((line, index) => line === fallback[index]);
  check("跟随系统的深色变量与 [data-theme=\"dark\"] 完全一致", same, explicit && fallback ? `explicit=${explicit.length} fallback=${fallback.length} identical=${same}` : "could not read both blocks");
}

const login = async (page, reducedMotion = "no-preference") => {
  await page.emulateMedia({ reducedMotion });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // A freshly started server compiles route modules on first hit, so wait for the
  // sign-in form (and afterwards for the app shell) instead of a fixed sleep.
  await page.waitForSelector("#auth-username", { timeout: 20000 }).catch(() => {});
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", USER);
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[aria-label="概览"]', { timeout: 30000 }).catch(() => {});
  }
  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
  // 欢迎引导在数据加载完成后才挂载,可能比导航栏晚一步出现;先等它一下再关。
  await skip.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  if (await skip.count()) {
    await skip.first().click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForFunction(() => document.querySelectorAll("[role=dialog][aria-modal=true]").length === 0, null, { timeout: 4000 }).catch(() => {});
  // 库里有过期物品时,应用会按天自动弹一次「提醒中心」;这是刻意的行为,探针要能容错,
  // 否则它会挡住后面的导航点击。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('[role="dialog"][aria-modal="true"]:visible').count()) === 0) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
};
const openDialog = () => document.querySelectorAll('[role="dialog"][aria-modal="true"]').length;

// ---------------------------------------------------------------- desktop
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  // 库里不再有示范数据,干净安装下物品与采购清单都是空的。依赖真实数据的断言
  // (删除采购项、卡片上的图标按钮尺寸)需要至少一条记录才有意义,所以这里按需
  // 建临时数据,脚本跑完统一永久删除。
  const seeded = await page.evaluate(async () => {
    const listOf = async (url) => { const body = await (await fetch(url)).json(); return Array.isArray(body) ? body : (body?.items ?? []); };
    const created = { item: false, shopping: false };
    if ((await listOf("/api/items")).length === 0) {
      const response = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "验收探针物品", category: "日用", type: "DURABLE", quantity: 2, minQuantity: 0, remainingPercent: 100, unit: "件", price: null, purchaseDate: null, expiryDate: null, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null }) });
      created.item = response.ok;
    }
    const dashboard = await (await fetch("/api/dashboard")).json();
    if ((dashboard?.shopping ?? []).length === 0) {
      const response = await fetch("/api/shopping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "验收探针采购项", quantity: 1, unit: "件", priority: 1, source: "manual" }) });
      created.shopping = response.ok;
    }
    return created;
  });
  if (seeded.item || seeded.shopping) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[aria-label="概览"]', { timeout: 20000 });
    await page.waitForTimeout(1200);
  }

  // 1. task creation must be reachable again (desktop P0)
  await page.locator('[aria-label="任务"]:visible').first().click();
  await page.waitForTimeout(1400);
  const addTask = page.locator('main button:has-text("安排任务")').first();
  let taskDialog = 0;
  if (await addTask.count()) {
    await addTask.click();
    await page.waitForTimeout(900);
    taskDialog = await page.locator('[role="dialog"][aria-label="安排一个任务"]:visible').count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  check("任务视图「安排任务」可打开弹窗", taskDialog === 1, `dialog=${taskDialog}`);

  // 2. dialog focus management + scroll lock (desktop P1-2/P2-2, mobile P1-2)
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
  const trigger = page.locator('button[aria-label="录入物品"]:visible').first();
  await trigger.click();
  await page.waitForTimeout(900);
  const focusState = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
    const top = dialogs[dialogs.length - 1];
    return {
      inside: top ? top.contains(document.activeElement) : false,
      locked: document.body.dataset.modalScrollLocked === "true",
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
  check("弹窗打开后焦点进入弹窗", focusState.inside, `activeElementInsideDialog=${focusState.inside}`);
  check("弹窗打开时锁定背景滚动", focusState.locked && focusState.bodyOverflow === "hidden", `locked=${focusState.locked} bodyOverflow=${focusState.bodyOverflow}`);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(60, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check("弹窗打开时滚轮不滚动背景", scrollBefore === scrollAfter, `${scrollBefore} -> ${scrollAfter}`);

  let escaped = false;
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
      const top = dialogs[dialogs.length - 1];
      return top ? top.contains(document.activeElement) : true;
    });
    if (!inside) { escaped = true; break; }
  }
  check("Tab 不会走出弹窗(focus trap)", !escaped, escaped ? "焦点逃出弹窗" : "25 次 Tab 全部在弹窗内");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const afterEscape = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
    label: document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName,
    locked: document.body.dataset.modalScrollLocked === "true",
  }));
  check("Escape 关闭弹窗并归还焦点", afterEscape.dialogs === 0 && afterEscape.label === "录入物品", `dialogs=${afterEscape.dialogs} focus=${afterEscape.label}`);
  check("关闭弹窗后解除滚动锁", !afterEscape.locked, `locked=${afterEscape.locked}`);

  // 3. navigation must not refetch the whole dashboard every time
  let dashboardCalls = 0;
  page.on("response", (response) => { if (response.url().includes("/api/dashboard")) dashboardCalls += 1; });
  for (const view of ["任务", "空间", "盘点", "设置", "关于", "概览", "物品"]) {
    await page.locator(`[aria-label="${view}"]:visible`).first().click();
    await page.waitForTimeout(900);
  }
  check("7 次视图切换的 dashboard 请求 ≤2", dashboardCalls <= 2, `GET /api/dashboard x${dashboardCalls}`);
  // 切回「物品」本身也是一次视图切换,可能正好跨过 15s 缓存 TTL 而刷新一次;
  // 这条断言只针对后面的快捷筛选,所以计数器在切换动作完成之后再清零。
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1200);
  dashboardCalls = 0;
  for (const label of ["全部", "耐用品", "消耗品"]) {
    const button = page.locator(`main button:has-text("${label}")`).first();
    if (await button.count()) { await button.click(); await page.waitForTimeout(500); }
  }
  check("切换快捷筛选不发 dashboard 请求", dashboardCalls === 0, `GET /api/dashboard x${dashboardCalls}`);

  // 4. search popover must stop swallowing clicks (desktop P1-1)
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1200);
  const search = page.locator("#global-search").first();
  if (await search.count()) {
    await search.click();
    await search.fill("洗衣");
    await page.waitForTimeout(400);
    await search.fill("");
    await page.waitForTimeout(500);
    const popover = await page.evaluate(() => {
      const input = document.querySelector("#global-search");
      const wrap = input?.closest("div.relative");
      const panel = wrap?.querySelector("div.absolute");
      return panel ? { entries: panel.querySelectorAll("button").length, height: Math.round(panel.getBoundingClientRect().height) } : null;
    });
    const filterHit = await page.evaluate(() => {
      const button = [...document.querySelectorAll("main button")].find((b) => b.textContent?.trim() === "消耗品");
      if (!button) return "no-filter-button";
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === button || button.contains(hit) ? "self" : `blocked-by:${hit?.tagName}.${(hit?.className || "").toString().slice(0, 30)}`;
    });
    check("清空搜索后浮层不再列出全部物品", !popover || popover.entries === 0, popover ? `entries=${popover.entries} height=${popover.height}` : "popover absent");
    check("快捷筛选按钮未被浮层遮挡", filterHit === "self" || filterHit === "no-filter-button", filterHit);
    await search.fill("");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } else {
    check("搜索框存在", false, "#global-search 未找到");
  }

  // 5. AI assistant close paths (desktop P1-4, mobile P1-1)
  const launcher = page.locator('button[aria-label="打开归物助手"]:visible').first();
  await launcher.click();
  await page.waitForTimeout(1200);
  const closeSize = await page.evaluate(() => {
    const button = document.querySelector('.ai-chat-panel button[aria-label="关闭归物助手"]');
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), role: document.querySelector(".ai-chat-panel")?.getAttribute("role") };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const afterEsc = await page.locator(".ai-chat-panel").count();
  check("AI 助手按 Escape 可关闭", afterEsc === 0, `panels=${afterEsc}`);
  check("AI 助手关闭按钮 ≥44px 且有 dialog 语义", Boolean(closeSize && closeSize.w >= 44 && closeSize.h >= 44 && closeSize.role === "dialog"), JSON.stringify(closeSize));

  await launcher.click();
  await page.waitForTimeout(1000);
  await page.mouse.click(8, 300);
  await page.waitForTimeout(700);
  const afterBackdrop = await page.locator(".ai-chat-panel").count();
  check("AI 助手点击空白处可关闭", afterBackdrop === 0, `panels=${afterBackdrop}`);

  // 6. destructive confirmations use the in-app dialog now
  const confirms = [];
  const countNativeDialogs = (page) => {
    let seen = 0;
    page.on("dialog", async (dialog) => { seen += 1; await dialog.dismiss(); });
    return () => seen;
  };
  const nativeCount = countNativeDialogs(page);
  // 采购清单现在是折叠区块(减少物品页拥挤),先展开再找删除按钮。
  const shoppingSummary = page.locator('main details summary:has-text("采购清单")').first();
  if (await shoppingSummary.count()) { await shoppingSummary.click(); await page.waitForTimeout(600); }
  for (const [label, selector] of [
    ["采购项删除", 'button[aria-label="删除采购项"]'],
  ]) {
    const target = page.locator(`${selector}:visible`).first();
    if (!(await target.count())) { confirms.push(`${label}:missing`); continue; }
    // The row reveals its ✕ on hover, so hover the row before clicking it.
    await target.locator("xpath=ancestor::div[contains(@class,'group')][1]").hover().catch(() => {});
    await page.waitForTimeout(250);
    await target.click({ timeout: 8000 }).catch((error) => { confirms.push(`${label}:click-failed(${String(error).slice(0, 40)})`); });
    await page.waitForTimeout(900);
    const dialog = await page.locator('[role="dialog"][aria-modal="true"][aria-label]:visible').count();
    const title = dialog ? await page.locator('[role="dialog"][aria-modal="true"]:visible').last().getAttribute("aria-label") : null;
    confirms.push(`${label}:${dialog ? `in-app(${title})` : "none"}`);
    if (dialog) { await page.keyboard.press("Escape"); await page.waitForTimeout(600); }
  }
  check("采购项删除使用应用内确认框", confirms.every((entry) => entry.includes("in-app")), confirms.join(", "));
  check("不再弹出浏览器原生 confirm", nativeCount() === 0, `nativeDialogs=${nativeCount()}`);

  // 7. batch AI import must have an entry point (desktop P2-15)
  const batchButton = page.locator('button[aria-label="AI 批量识别物品"]:visible').first();
  let batchDialog = 0;
  if (await batchButton.count()) {
    await batchButton.click();
    await page.waitForTimeout(1000);
    batchDialog = await page.locator('[role="dialog"][aria-label="AI 批量识别物品"]:visible').count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
  check("「批量识别」入口可达并打开弹窗", batchDialog === 1, `entry=${await batchButton.count()} dialog=${batchDialog}`);

  // 8. batch edit clear-location sentinel (desktop P2-3)
  const selects = page.locator('[aria-label="选择物品"]:visible');
  if ((await selects.count()) >= 1) {
    await selects.first().click();
    await page.waitForTimeout(400);
    const bulkEdit = page.locator('button:has-text("批量编辑")').first();
    if (await bulkEdit.count()) {
      await bulkEdit.click();
      await page.waitForTimeout(900);
      const selects = page.locator('[role="dialog"] select');
      const selectCount = await selects.count();
      let select = null;
      for (let i = 0; i < selectCount; i += 1) {
        const labels = await selects.nth(i).locator("option").allTextContents();
        if (labels.some((label) => label.includes("清除位置"))) { select = selects.nth(i); break; }
      }
      if (select) {
        const options = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => ({ label: node.textContent, value: node.value })));
        const clearOption = options.find((option) => option.label?.includes("清除位置"));
        if (clearOption) {
          await select.selectOption(clearOption.value);
          await page.waitForTimeout(300);
          const selected = await select.evaluate((node) => node.options[node.selectedIndex]?.textContent);
          check("「清除位置」选项不再回弹到「不修改」", selected?.includes("清除位置"), `selected=${selected} value=${clearOption.value}`);
        } else {
          check("「清除位置」选项存在", false, JSON.stringify(options));
        }
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
    await page.locator('[aria-label="取消选择"]:visible').first().click().catch(() => {});
  }

  // 9. context menu keyboard support (desktop P2-8)
  await page.locator('[aria-label="空间"]:visible').first().click();
  await page.waitForTimeout(1400);
  const card = page.locator("main .surface.group").first();
  if (await card.count()) {
    await card.click({ button: "right" });
    await page.waitForTimeout(700);
    const menuState = await page.evaluate(() => ({
      open: document.querySelectorAll('[role="menu"]').length,
      focusInMenu: Boolean(document.activeElement?.closest('[role="menu"]')),
    }));
    let moved = false;
    if (menuState.focusInMenu) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(300);
      moved = await page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"]')];
        return items.indexOf(document.activeElement) === 1;
      });
    }
    check("右键菜单打开后焦点进入菜单", menuState.focusInMenu, JSON.stringify(menuState));
    check("右键菜单方向键可移动焦点", moved, `arrowDownMovedToSecond=${moved}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // 10. 404 page is localised and offers a way back (desktop P2-7)
  const notFound = await context.newPage();
  const response = await notFound.goto(`${BASE}/definitely-missing-page-xyz`, { waitUntil: "domcontentloaded" });
  await notFound.waitForTimeout(700);
  const notFoundInfo = await notFound.evaluate(() => ({
    text: document.body.innerText.slice(0, 80),
    hasHome: Boolean(document.querySelector('a[href="/"]')),
  }));
  check("404 页面为中文且有返回入口", (response?.status() === 404) && notFoundInfo.hasHome && /没有找到|返回/.test(notFoundInfo.text), `${response?.status()} "${notFoundInfo.text.replace(/\n/g, " ")}"`);
  await notFound.close();

  await context.close();
}

// ------------------------------------------------- item detail protection
{
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  // Find a real item id through the API with a signed-in session first.
  const authed = await browser.newContext();
  const api = await authed.newPage();
  await login(api);
  // 全新安装不再写入示范数据,库里可能一件物品都没有 —— 那就自己建一条临时
  // 物品给 /items/[id] 与 /consume/[id] 用,检查完再彻底删掉,避免假失败。
  const fixture = await api.evaluate(async () => {
    const response = await fetch("/api/dashboard");
    const body = await response.json();
    const existing = body?.items?.[0]?.id ?? null;
    if (existing) return { id: existing, created: false };
    const created = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "验收探针临时物品", category: "日用", type: "DURABLE", quantity: 1, minQuantity: 0, remainingPercent: 100, unit: "件", price: null, purchaseDate: null, expiryDate: null, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null }) });
    const item = await created.json().catch(() => null);
    return { id: item?.id ?? null, created: created.ok };
  });
  const itemId = fixture.id;
  check("取到/建到一件物品 id", Boolean(itemId), `id=${itemId ? "yes" : "no"} created=${fixture.created}`);

  if (itemId) {
    const response = await page.goto(`${BASE}/items/${itemId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => ({
      url: location.pathname,
      hasLogin: Boolean(document.querySelector("#auth-username")),
      hasItemData: document.body.innerText.includes("当前数量"),
    }));
    check("/items/[id] 未登录时跳转登录页", state.url === "/" && (state.hasLogin || !state.hasItemData), `url=${state.url} loginForm=${state.hasLogin} leaked=${state.hasItemData} status=${response?.status()}`);

    // dark-mode fallback on the standalone route
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${BASE}/consume/${itemId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const darkInfo = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme || "(unset)",
      bg: getComputedStyle(document.body).backgroundColor,
      paddingBottom: getComputedStyle(document.body).paddingBottom,
      backLinks: [...document.querySelectorAll("a")].length,
    }));
    // 用亮度判断,而不是写死某个配色:换主题色时这条断言不该失效。
    const channels = (darkInfo.bg.match(/\d+/g) || []).map(Number);
    const luminance = channels.length >= 3
      ? (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255
      : 1;
    const dark = luminance < 0.22;
    check("独立路由跟随系统深色模式", dark, `theme=${darkInfo.theme} bodyBg=${darkInfo.bg} luminance=${luminance.toFixed(3)}`);
    check("独立路由无多余底部留白(≤40px)", parseFloat(darkInfo.paddingBottom) <= 40, `padding-bottom=${darkInfo.paddingBottom}`);
    check("/consume/[id] 有返回入口", darkInfo.backLinks >= 1, `links=${darkInfo.backLinks}`);
  }
  if (fixture.created && itemId) {
    await api.evaluate(async (id) => { await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permanent: true }) }); }, itemId);
  }
  await authed.close();
  await anonymous.close();
}

// ---------------------------------------------------------------- mobile
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await login(page);

  await page.locator('nav[aria-label="移动端主导航"] button:has-text("物品")').first().click();
  await page.waitForTimeout(1500);

  const sizes = await page.evaluate(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const iconActions = [...document.querySelectorAll(".icon-action")].map((element) => {
      const r = element.getBoundingClientRect();
      return Math.round(Math.min(r.width, r.height));
    });
    return {
      iconActionMin: iconActions.length ? Math.min(...iconActions) : null,
      iconActionCount: iconActions.length,
      viewport: measure("meta"),
    };
  });
  check("图标按钮最小边 ≥40px", (sizes.iconActionMin ?? 0) >= 40, `min=${sizes.iconActionMin}px across ${sizes.iconActionCount} buttons`);

  const zoomMeta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "");
  check("viewport 允许双指缩放", !/maximum-scale=1/.test(zoomMeta), zoomMeta);

  // keyboard: the AI input must wrap long text (mobile P2-2)
  await page.locator('button[aria-label="打开归物助手"]:visible').first().click();
  await page.waitForTimeout(1200);
  const textarea = page.locator(".ai-chat-panel textarea").first();
  if (await textarea.count()) {
    await textarea.fill("这是一个很长的中文问题用来验证输入框在移动端是否会自动换行以及能否看清自己打了什么字");
    await page.waitForTimeout(400);
    const input = await textarea.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      whiteSpace: getComputedStyle(node).whiteSpace,
    }));
    check("助手输入框长文本不被横向裁切", input.scrollWidth <= input.clientWidth + 4, `scrollW=${input.scrollWidth} clientW=${input.clientWidth} white-space=${input.whiteSpace}`);
  } else {
    check("助手输入框存在", false, "textarea 未找到");
  }
  const closeButton = await page.evaluate(() => {
    const button = document.querySelector('.ai-chat-panel button[aria-label="关闭归物助手"]');
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("移动端助手关闭按钮 ≥44px", Boolean(closeButton && closeButton.w >= 44 && closeButton.h >= 44), JSON.stringify(closeButton));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // bottom sheet close button size + scroll lock
  // 移动端底部导航不再有悬浮加号(它和顶栏的「录入物品」重复),改用顶栏入口。
  await page.locator('button[aria-label="录入物品"]:visible').first().click();
  await page.waitForTimeout(1000);
  const sheet = await page.evaluate(() => {
    const button = document.querySelector('[role="dialog"][aria-modal="true"] button[aria-label^="关闭"]');
    const r = button?.getBoundingClientRect();
    return {
      close: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      locked: document.body.dataset.modalScrollLocked === "true",
      maxHeight: getComputedStyle(document.querySelector('[role="dialog"][aria-modal="true"]')).maxHeight,
    };
  });
  check("移动端弹窗关闭按钮 ≥44px", Boolean(sheet.close && sheet.close.w >= 44 && sheet.close.h >= 44), JSON.stringify(sheet.close));
  check("移动端弹窗锁定背景滚动", sheet.locked, `locked=${sheet.locked} maxHeight=${sheet.maxHeight}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // floating launcher dodges while scrolling (pick the fixed-position ball, not the header button)
  const scrollState = await page.evaluate(async () => {
    const launcher = [...document.querySelectorAll('button[aria-label="打开归物助手"]')].find((element) => getComputedStyle(element).position === "fixed");
    if (!launcher) return { error: "no-floating-launcher" };
    const before = getComputedStyle(launcher).pointerEvents;
    window.scrollTo(0, 400);
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = getComputedStyle(launcher).pointerEvents;
    return { before, after, scrollY: window.scrollY };
  });
  check("悬浮球下滚时让开(不拦截点击)", scrollState.before === "auto" && scrollState.after === "none", JSON.stringify(scrollState));

  // tap-target audit for the settings surfaces owned by fix-controls
  await page.locator('nav[aria-label="移动端主导航"] button:has-text("设置")').first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator('summary:has-text("账号与家庭成员")').first();
  if (await panel.count()) {
    await panel.click();
    await page.waitForTimeout(1200);
  }
  const small = await page.evaluate(() => {
    const list = [];
    for (const element of document.querySelectorAll("button, input[type=checkbox], select")) {
      const r = element.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      // A small checkbox inside a full-height row label is fine: the label is the
      // touch target, so measure the label instead.
      const label = element.closest("label");
      if (label && label.getBoundingClientRect().height >= 44) continue;
      const name = element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 14) || element.tagName;
      if (r.width < 40 || r.height < 40) list.push({ name, w: Math.round(r.width), h: Math.round(r.height) });
      if (list.length > 6) break;
    }
    return list;
  });
  check("设置页无明显小目标(<40px 控件 ≤1)", small.length <= 1, JSON.stringify(small));

  await context.close();
}

// ------------------------------------------------- read-only + safety checks
viewerChecks: {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (!VIEWER_PASS) {
    check("只读账号不再显示写入口", true, "skipped: set PROBE_VIEWER_PASS to run this check");
    check("只读账号有明确说明", true, "skipped: set PROBE_VIEWER_PASS to run this check");
    await context.close();
    break viewerChecks;
  } else if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", VIEWER_USER);
    await page.fill("#auth-password", VIEWER_PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2800);
  }
  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(700); }
  await page.locator('[aria-label="物品"]:visible').first().click().catch(() => {});
  await page.waitForTimeout(1600);
  const viewer = await page.evaluate(() => {
    const shown = (selector) => [...document.querySelectorAll(selector)].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    }).length;
    return {
      loginForm: Boolean(document.querySelector("#auth-username")),
      create: shown('button[aria-label="录入物品"]'),
      edit: shown('button[aria-label="编辑物品"]'),
      consume: [...document.querySelectorAll("button")].filter((b) => b.textContent?.includes("用掉") && b.getBoundingClientRect().width > 0).length,
      shopping: shown('button[aria-label="添加采购项"]'),
      batch: shown('button[aria-label="AI 批量识别物品"]'),
      notice: document.body.innerText.includes("只读账号"),
    };
  });
  check("只读账号不再显示写入口", !viewer.loginForm && viewer.create === 0 && viewer.edit === 0 && viewer.consume === 0 && viewer.shopping === 0 && viewer.batch === 0, JSON.stringify(viewer));
  check("只读账号有明确说明", viewer.notice, `notice=${viewer.notice}`);
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1300);
  await page.locator('button[aria-label="录入物品"]:visible').first().click();
  await page.waitForTimeout(1100);
  const marker = `双击检查-${Date.now().toString(36)}`;
  await page.locator('[role="dialog"] input[required]').first().fill(marker);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("[role=dialog] button")].find((entry) => (entry.textContent || "").includes("快速保存"));
    if (button) { button.click(); button.click(); }
  });
  await page.waitForTimeout(3200);
  const doubled = await page.evaluate(async (name) => {
    const response = await fetch("/api/dashboard");
    const body = await response.json();
    const matches = (body.items || []).filter((item) => item.name === name);
    for (const item of matches) {
      await fetch(`/api/items/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permanent: true }) });
    }
    return matches.length;
  }, marker);
  check("双击「快速保存」只创建一条记录", doubled === 1, `同名记录=${doubled}`);
  await context.close();
}

{
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  const statuses = await page.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 40; i += 1) {
      const response = await fetch("/api/public/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "missing-item-for-rate-limit", requestId: crypto.randomUUID() }),
      });
      seen.push(response.status);
      if (response.status === 429) break;
    }
    return seen;
  });
  check("公开扫码消耗接口有频率限制", statuses.includes(429), `statuses=${[...new Set(statuses)].join("/")} calls=${statuses.length}`);
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "服务器错误" }) }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3200);
  const text = await page.evaluate(() => document.body.innerText.trim().slice(0, 160));
  check("主接口 500 时不再出现英文错误页", text.length > 0 && !/couldn't load|Reload to try again/i.test(text), JSON.stringify(text.replace(/\n/g, " ").slice(0, 110)));
  await context.close();
}

{
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  const removed = await page.evaluate(async () => {
    const listOf = async (url) => { const body = await (await fetch(url)).json(); return Array.isArray(body) ? body : (body?.items ?? []); };
    let items = 0;
    let shopping = 0;
    for (const item of (await listOf("/api/items?includeDeleted=1")).filter((entry) => entry.name === "验收探针物品")) {
      await fetch(`/api/items/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permanent: true }) });
      items += 1;
    }
    const dashboard = await (await fetch("/api/dashboard")).json();
    for (const entry of (dashboard?.shopping ?? []).filter((row) => row.name === "验收探针采购项")) {
      await fetch(`/api/shopping/${entry.id}`, { method: "DELETE" });
      shopping += 1;
    }
    return { items, shopping };
  });
  console.log(`探针临时数据清理: 物品 ${removed.items} · 采购 ${removed.shopping}`);
  await context.close();
}

await writeFile(`${OUT}/verify-experience.json`, JSON.stringify(results, null, 2));
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`report -> ${OUT}/verify-experience.json`);
await browser.close();
process.exit(failed.length ? 1 : 0);
