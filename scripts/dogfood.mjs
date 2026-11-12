// Deep-experience harness: walks every surface, screenshots it, and reports
// layout/accessibility/interaction problems as machine-readable JSON.
//
//   BASE_URL=http://127.0.0.1:3001 PROBE_USER=admin PROBE_PASS=... \
//   TAG=base MODE=all node scripts/dogfood.mjs
//
// MODE: all | desktop | mobile
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "admin";
const PASS = process.env.PROBE_PASS;
const TAG = process.env.SHOT_TAG || process.env.TAG || "base";
const MODE = process.env.MODE || "all";
const OUT = "output/experience";
if (!PASS) throw new Error("set PROBE_PASS before running this script");

const EXECUTABLE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;

await mkdir(OUT, { recursive: true });

const VIEWS = ["概览", "物品", "任务", "空间", "盘点", "设置", "关于"];

const browser = await chromium.launch({ executablePath: EXECUTABLE });

// ---------------------------------------------------------------- collectors
const collect = () =>
  // Runs in the page. Returns the topmost-surface audit for the current state.
  (() => {
    const out = { clipped: [], obstructed: [], smallTargets: [], overflowX: null, contrast: [] };
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
    const scope = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
    const visible = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && r.width > 0 && r.height > 0;
    };

    scope.querySelectorAll("*").forEach((el) => {
      if (el.children.length || !visible(el)) return;
      const text = (el.textContent || "").trim();
      if (!text) return;
      const s = getComputedStyle(el);
      if (s.overflowX !== "hidden" && s.overflow !== "hidden") return;
      const cls = el.getAttribute("class") || "";
      if (cls.includes("truncate") || cls.includes("sr-only")) return;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.clipped.push({ text: text.slice(0, 40), over: el.scrollWidth - el.clientWidth, cls: cls.slice(0, 70) });
      }
    });

    const label = (node) =>
      (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || node.tagName).trim().slice(0, 24);
    const controls = [...scope.querySelectorAll("button, a, input, select, summary, textarea, [role=slider]")].filter(visible);
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit) continue;
      const isButtonish = (n) => n && n.closest("button, a, input, select, summary, textarea");
      const self = isButtonish(el);
      if (hit === el || el.contains(hit)) continue;
      const blocker = isButtonish(hit);
      if (!blocker || blocker === el || el.contains(blocker) || blocker.contains(el)) continue;
      if (el.closest("label") && el.closest("label") === blocker.closest("label")) continue;
      out.obstructed.push({ detail: `${label(el)}@${Math.round(cx)},${Math.round(cy)} covered by ${label(blocker)}` });
    }

    // Touch-target size only matters on a touch viewport.
    if (innerWidth <= 500) {
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        if (el.closest("nav") && tag !== "input") continue; // bottom bar is intentionally generous
        if (r.width < 28 || r.height < 28) {
          out.smallTargets.push({ detail: label(el), w: Math.round(r.width), h: Math.round(r.height), tag });
        }
      }
    }

    if (!dialogs.length && document.documentElement.scrollWidth > innerWidth + 1) {
      out.overflowX = { scrollWidth: document.documentElement.scrollWidth, innerWidth };
    }
    return out;
  })();

const summarize = (raw) => {
  const seen = new Set();
  const uniq = (list, key) => {
    const res = [];
    for (const entry of list) {
      const k = key(entry);
      if (seen.has(`x${k}`)) continue;
      seen.add(`x${k}`);
      res.push(entry);
    }
    return res;
  };
  return {
    clipped: uniq(raw.clipped, (e) => e.text).slice(0, 10),
    obstructed: uniq(raw.obstructed, (e) => e.detail).slice(0, 10),
    smallTargets: uniq(raw.smallTargets, (e) => e.detail + e.w + e.h).slice(0, 12),
    overflowX: raw.overflowX,
  };
};

// ---------------------------------------------------------------- walk logic
const runProfile = async ({ name, viewport, colorScheme, isMobile }) => {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  const report = { profile: name, viewport, colorScheme, steps: [], consoleErrors: [], failedRequests: [], issues: [] };
  const issues = [];
  const push = (where, res) => {
    const s = summarize(res);
    const count = s.clipped.length + s.obstructed.length + s.smallTargets.length + (s.overflowX ? 1 : 0);
    if (count) issues.push({ where, ...s });
    report.steps.push({ where, clipped: s.clipped.length, obstructed: s.obstructed.length, small: s.smallTargets.length, overflowX: !!s.overflowX });
  };

  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => report.consoleErrors.push("pageerror " + String(e).slice(0, 240)));
  page.on("response", (r) => {
    if (r.status() >= 400) report.failedRequests.push(`${r.status()} ${r.url().replace(BASE, "")}`);
  });

  const shot = async (label) => {
    await page.screenshot({ path: `${OUT}/${TAG}-${name}-${label}.png`, animations: "disabled", timeout: 25000 }).catch(() => {});
  };
  const audit = async (where) => push(where, await page.evaluate(collect));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", USER);
    await page.fill("#auth-password", PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2600);
  }
  if (await page.locator("#auth-username").count()) throw new Error(`${name}: login rejected`);
  await audit("auth");
  await shot("00-auth");

  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]');
  if (await skip.count()) {
    await shot("01-welcome");
    await audit("welcome-modal");
    await skip.first().click();
    await page.waitForTimeout(600);
  }

  const navTo = async (label) => {
    const mobileBar = page.locator(`nav[aria-label="移动端主导航"] button:has-text("${label}")`).first();
    const aria = page.locator(`[aria-label="${label}"]:visible`).first();
    if (isMobile && (await mobileBar.count())) {
      await mobileBar.click({ timeout: 8000 }).catch(() => {});
    } else if (await aria.count()) {
      await aria.click({ timeout: 8000 }).catch(() => {});
    } else if (await mobileBar.count()) {
      await mobileBar.click({ timeout: 8000 }).catch(() => {});
    } else {
      return false;
    }
    await page.waitForTimeout(1400);
    return true;
  };

  let index = 2;
  for (const view of VIEWS) {
    if (isMobile && (view === "盘点" || view === "空间" || view === "关于")) {
      // Reachable through settings/header on mobile; covered by the desktop pass.
      if (view === "关于") continue;
      if (view === "盘点" || view === "空间") {
        const extra = page.locator(`[aria-label="${view}"]:visible`).first();
        if (!(await extra.count())) continue;
      }
    }
    if (!(await navTo(view))) continue;
    await audit(`view:${view}`);
    await shot(`${String(index).padStart(2, "0")}-${view}`);
    index += 1;
  }

  // Settings sub-panels (each summary is a real surface).
  if (isMobile || MODE !== "mobile") {
    for (const label of ["账号与家庭成员", "AI 模型与识别", "图片存储", "数据与部署", "外观与偏好", "家庭偏好"]) {
      const toggle = page.locator(`summary:has-text("${label}")`).first();
      if (!(await toggle.count())) continue;
      await toggle.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1300);
      await audit(`settings:${label}`);
      await shot(`${String(index).padStart(2, "0")}-settings-${label}`);
      index += 1;
      await toggle.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  // Modals reachable from the app shell.
  const modals = [
    ["录入物品", 'button[aria-label="录入物品"]', "modal:new-item"],
    ["查看提醒", 'button[aria-label="查看提醒"]', "modal:notifications"],
    ["回收站", 'button[aria-label="回收站"]', "modal:recycle"],
    ["打开归物助手", 'button[aria-label="打开归物助手"]', "modal:assistant"],
    ["添加物品", 'button[aria-label="添加物品"]', "modal:new-item-mobile"],
  ];
  for (const [aria, selector, where] of modals) {
    const trigger = page.locator(`${selector}:visible`).first();
    if (!(await trigger.count())) continue;
    await trigger.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1300);
    await audit(where);
    await shot(`${String(index).padStart(2, "0")}-${where.replace(/[:]/g, "-")}`);
    index += 1;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    // Some surfaces close on the mask instead of Escape; make sure we are back.
    if (await page.locator('[role="dialog"][aria-modal="true"]').count()) {
      await page.mouse.click(8, 8);
      await page.waitForTimeout(500);
    }
  }

  report.issues = issues;
  report.consoleErrors = [...new Set(report.consoleErrors)];
  report.failedRequests = [...new Set(report.failedRequests)];
  await context.close();
  return report;
};

const profiles = [];
if (MODE === "all" || MODE === "desktop") {
  profiles.push({ name: "desktop-light", viewport: { width: 1440, height: 900 }, colorScheme: "light", isMobile: false });
  profiles.push({ name: "desktop-dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark", isMobile: false });
}
if (MODE === "all" || MODE === "mobile") {
  profiles.push({ name: "mobile-light", viewport: { width: 390, height: 844 }, colorScheme: "light", isMobile: true });
  profiles.push({ name: "mobile-dark", viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true });
}

const reports = [];
for (const profile of profiles) {
  try {
    const report = await runProfile(profile);
    reports.push(report);
    console.log(`\n### ${report.profile}`);
    for (const step of report.steps) {
      const bad = step.clipped + step.obstructed + step.small + (step.overflowX ? 1 : 0);
      if (bad) console.log(`  ! ${step.where}: clipped=${step.clipped} obstructed=${step.obstructed} small=${step.small} overflowX=${step.overflowX}`);
    }
    for (const issue of report.issues) {
      console.log(`  -- ${issue.where}`);
      for (const c of issue.clipped) console.log(`       clip  "${c.text}" +${c.over} [${c.cls}]`);
      for (const o of issue.obstructed) console.log(`       cover ${o.detail}`);
      for (const s of issue.smallTargets) console.log(`       small ${s.detail} ${s.w}x${s.h} <${s.tag}>`);
      if (issue.overflowX) console.log(`       overflowX ${issue.overflowX.scrollWidth} > ${issue.overflowX.innerWidth}`);
    }
    if (report.consoleErrors.length) console.log(`  console: ${report.consoleErrors.slice(0, 6).join(" | ")}`);
    if (report.failedRequests.length) console.log(`  http>=400: ${report.failedRequests.slice(0, 6).join(" | ")}`);
  } catch (error) {
    console.log(`\n### ${profile.name} FAILED: ${error.message}`);
    reports.push({ profile: profile.name, fatal: String(error.message) });
  }
}

await writeFile(`${OUT}/${TAG}-report.json`, JSON.stringify(reports, null, 2));
console.log(`\nreport -> ${OUT}/${TAG}-report.json`);
await browser.close();
