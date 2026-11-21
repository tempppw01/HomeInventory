// 关于页与版本号一致性验收。
//
// 起因:界面上显示的版本号此前是**手写在 src/lib/version.ts 里的 "0.0.8"**,
// 而 package.json 早就 0.1.x 了 —— 也就是说「关于」页、设置页、顶栏显示的版本一直是错的。
// 根因是同一个事实存了两份。现在版本号由 next.config.ts 在构建期从 package.json 注入,
// 这条检查守住「界面显示的版本 = package.json 的版本」。
//
// 顺带补齐:`/about` 此前是唯一没有被任何套件访问过的页面。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-about-and-version.mjs

import { readFileSync } from "node:fs";
import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const expectedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const finish = async (code) => {
  await context.close();
  await browser.close();
  process.exit(code);
};

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) await finish(1);

console.log(`      package.json 版本:${expectedVersion}`);

// ---------- ① 关于页能打开,并且显示的版本与 package.json 一致 ----------
await page.goto(`${BASE}/about`);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);

const about = await page.evaluate(() => {
  const text = (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | ");
  const versions = [...text.matchAll(/\d+\.\d+\.\d+/g)].map((match) => match[0]);
  const releasesLink = Array.from(document.querySelectorAll("main a")).find((node) => /releases/.test(node.getAttribute("href") || ""));
  return { text, versions: [...new Set(versions)], releasesHref: releasesLink ? releasesLink.getAttribute("href") : null };
});

check("关于页能正常打开", about.text.includes("归物"), about.text.slice(0, 120));
check(
  `关于页显示的版本就是 package.json 里的(${expectedVersion})`,
  about.versions.includes(expectedVersion),
  `页面上出现的版本号=${about.versions.join(", ") || "(没找到)"}`,
);
check("关于页不再出现旧的写死版本", !about.versions.includes("0.0.8"), about.versions.join(", "));
check("关于页有指向 Releases 的入口(而不是写死的更新说明)", Boolean(about.releasesHref), about.releasesHref ?? "没有找到 Releases 链接");
check("关于页不再出现写死的旧发版说明", !/维护版本:修正界面密度/.test(about.text), about.text.slice(0, 160));

// ---------- ② 设置页里的版本也要一致 ----------
await page.goto(`${BASE}/settings`);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);
await page.evaluate(() => { document.querySelectorAll("details").forEach((node) => { node.open = true; }); });
await page.waitForTimeout(600);

const settings = await page.evaluate(() => {
  const text = (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | ");
  return { versions: [...new Set([...text.matchAll(/\d+\.\d+\.\d+/g)].map((match) => match[0]))], text };
});

check(`设置页也显示同一个版本(${expectedVersion})`, settings.versions.includes(expectedVersion), `版本号=${settings.versions.join(", ") || "(没找到)"}`);
check("设置页没有残留旧版本号", !settings.versions.includes("0.0.8"), settings.versions.join(", "));

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);

await finish(failed.length ? 1 : 0);