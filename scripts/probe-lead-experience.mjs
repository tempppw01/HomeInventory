// Lead interaction-quality probe: feedback latency, optimistic updates, focus
// management, keyboard access and reduced-motion behaviour on the hot paths.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");
const OUT = "output/experience";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`,
});

const findings = [];
const note = (id, detail) => {
  findings.push({ id, detail });
  console.log(`${id}: ${detail}`);
};

const login = async (page, reducedMotion = "no-preference") => {
  await page.emulateMedia({ reducedMotion });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", "admin");
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2600);
  }
  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(600);
  }
};

// ---------------------------------------------------------------- focus mgmt
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  for (const [label, selector] of [
    ["录入物品", 'button[aria-label="录入物品"]'],
    ["查看提醒", 'button[aria-label="查看提醒"]'],
    ["回收站", 'button[aria-label="回收站"]'],
    ["AI 助手", 'button[aria-label="打开归物助手"]'],
  ]) {
    const trigger = page.locator(`${selector}:visible`).first();
    if (!(await trigger.count())) continue;
    await trigger.click();
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
      const top = dialogs[dialogs.length - 1];
      const active = document.activeElement;
      return {
        dialogCount: dialogs.length,
        activeTag: active?.tagName,
        activeLabel: active?.getAttribute("aria-label") || active?.id || (active?.textContent || "").trim().slice(0, 20),
        focusInsideDialog: top ? top.contains(active) : false,
        labelled: top ? !!(top.getAttribute("aria-label") || top.getAttribute("aria-labelledby")) : false,
      };
    });
    if (!state.focusInsideDialog) note(`focus-not-moved:${label}`, `打开「${label}」后焦点停在 <${state.activeTag}> "${state.activeLabel}",未进入弹窗`);
    if (state.dialogCount > 1) note(`dialog-stack:${label}`, `同时存在 ${state.dialogCount} 个 aria-modal 弹窗`);

    // Tab through the dialog and see whether focus can escape to the page behind.
    let escaped = false;
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
        const top = dialogs[dialogs.length - 1];
        if (!top) return true;
        return top.contains(document.activeElement) || document.activeElement === document.body;
      });
      if (!inside) {
        escaped = true;
        break;
      }
    }
    if (escaped) note(`focus-escapes:${label}`, `Tab 可把焦点移出「${label}」弹窗到背景页面(无 focus trap)`);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    const stillOpen = await page.locator('[role="dialog"][aria-modal="true"]').count();
    if (stillOpen) {
      note(`escape-fails:${label}`, `Escape 未能关闭「${label}」弹窗`);
      await page.mouse.click(5, 5);
      await page.waitForTimeout(500);
    } else {
      const restored = await page.evaluate(() => {
        const a = document.activeElement;
        return { tag: a?.tagName, label: a?.getAttribute("aria-label") || (a?.textContent || "").trim().slice(0, 16) };
      });
      if (restored.tag === "BODY") note(`focus-not-restored:${label}`, `关闭「${label}」后焦点回到 body,键盘用户失去位置`);
    }
  }
  await context.close();
}

// ---------------------------------------------------------- feedback latency
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  const measure = async (label, action, settle) => {
    const started = Date.now();
    await action();
    let firstPaint = null;
    for (let i = 0; i < 60; i += 1) {
      if (await settle()) {
        firstPaint = Date.now() - started;
        break;
      }
      await page.waitForTimeout(50);
    }
    note(`latency:${label}`, firstPaint === null ? ">3000ms 未观察到界面反馈" : `${firstPaint}ms`);
  };

  // View switch: does the target view render its heading promptly?
  await measure(
    "切换到物品视图",
    async () => {
      await page.locator('[aria-label="物品"]:visible').first().click();
    },
    async () => (await page.locator('h1:has-text("物品与采购")').count()) > 0,
  );

  await page.waitForTimeout(1200);
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1200);

  // Search typing responsiveness.
  const search = page.locator('input[placeholder*="搜索"], input[aria-label*="搜索"]').first();
  if (await search.count()) {
    const before = await page.locator('[aria-label="选择物品"]').count();
    await measure(
      "输入搜索词后列表收敛",
      async () => {
        await search.fill("洗衣");
        await page.keyboard.press("Enter").catch(() => {});
      },
      async () => (await page.locator('[aria-label="选择物品"]').count()) !== before,
    );
    await search.fill("");
    await page.waitForTimeout(900);
  }

  // Consume one unit on a consumable card and watch the quantity change.
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1200);
  const consume = page.locator('button:has-text("用掉"):visible').first();
  if (await consume.count()) {
    const card = consume.locator("xpath=ancestor::*[contains(@class,'group')][1]");
    const before = (await card.innerText().catch(() => "")).slice(0, 40);
    await measure(
      "点击用掉 1 单位",
      async () => {
        await consume.click();
      },
      async () => {
        const now = (await card.innerText().catch(() => "")).slice(0, 40);
        return now !== before;
      },
    );
  } else {
    note("latency:点击用掉 1 单位", "物品视图中未找到「用掉」按钮(无可消耗物品)");
  }

  // Task completion round-trip.
  await page.locator('[aria-label="任务"]:visible').first().click();
  await page.waitForTimeout(1500);
  const complete = page.locator('button[aria-label^="完成任务"]:visible').first();
  if (await complete.count()) {
    const before = await page.locator('button[aria-label^="完成任务"]').count();
    await measure(
      "标记任务完成",
      async () => {
        await complete.click();
      },
      async () => (await page.locator('button[aria-label^="完成任务"]').count()) !== before,
    );
  } else {
    note("latency:标记任务完成", "任务视图中没有可完成的任务");
  }

  await context.close();
}

// ------------------------------------------------------------ reduced motion
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, "reduce");
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1200);
  const moving = await page.evaluate(() => {
    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      const dur = [s.transitionDuration, s.animationDuration].join(",");
      const hasLong = dur.split(",").some((d) => parseFloat(d) > 0.1);
      if (!hasLong) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 60),
        dur: dur.slice(0, 40),
      });
      if (offenders.length > 6) break;
    }
    return offenders;
  });
  if (moving.length) {
    note(
      "reduced-motion-ignored",
      `prefers-reduced-motion: reduce 下仍有 ${moving.length}+ 个元素保留 >100ms 过渡/动画,例:${moving.map((m) => `${m.tag}.${m.cls.split(" ")[0]}(${m.dur})`).join(" ")}`,
    );
  } else {
    note("reduced-motion-ok", "reduce 下未发现长过渡");
  }
  await context.close();
}

// ------------------------------------------------- keyboard reachable actions
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await page.locator('[aria-label="物品"]:visible').first().click();
  await page.waitForTimeout(1400);

  const unreachable = await page.evaluate(() => {
    const res = [];
    for (const el of document.querySelectorAll("[onclick], [role=button], [tabindex], button, a")) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      if (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" || el.tagName === "SELECT") continue;
      const tabindex = el.getAttribute("tabindex");
      if (tabindex === null || Number(tabindex) < 0) {
        res.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
          cls: (el.className || "").toString().slice(0, 50),
        });
      }
      if (res.length > 8) break;
    }
    return res;
  });
  if (unreachable.length) {
    note("click-only-controls", `有 ${unreachable.length} 处只能点击、键盘不可达的控件:${unreachable.map((u) => `${u.label||u.tag}[${u.cls.split(" ")[0]}]`).join("; ")}`);
  } else {
    note("click-only-controls-ok", "物品视图未发现纯点击控件");
  }

  const focusRing = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="录入物品"]');
    if (!btn) return "no-button";
    btn.focus();
    const s = getComputedStyle(btn);
    return `outline=${s.outlineStyle} ${s.outlineWidth} boxShadow=${s.boxShadow.slice(0, 40)}`;
  });
  note("focus-ring:录入物品", focusRing);
  await context.close();
}

await writeFile(`${OUT}/lead-probe.json`, JSON.stringify(findings, null, 2));
console.log(`\n-> ${OUT}/lead-probe.json`);
await browser.close();
