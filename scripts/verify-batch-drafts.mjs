// 「AI 批量识别」草稿列表的身份检查。
//
// 为什么要有这一条:草稿行此前用**数组下标**当 React key。移除中间一条后,React 会把它的 DOM
// 节点留给下一条 —— 焦点停在「同一个按钮」上,而按钮已经属于另一件物品了。实测(键盘):
// 聚焦中间那行的「移除此项」按回车 → 删掉 B;再按一次回车 → **C 也被删了**,而用户只按了同一个按钮。
//
// 复现的关键是**要有一张能识别出物品的图**:本机试过外链(上游不接受远程 URL)和随手截的图(认不出),
// 都不行。这里用 sharp 现场生成一张写着商品名的图 —— 确定性输入,识别结果稳定。
//
// 没配置 AI 的环境按项目惯例跳过(打印 SKIP,不判红)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-batch-drafts.mjs

import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

// 现场生成一张「商品清单」图:模型读文字很稳,识别结果就是这三件
const dir = "output/tmp";
mkdirSync(dir, { recursive: true });
const imagePath = `${dir}/batch-draft-probe.png`;
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
  <rect width="900" height="900" fill="white"/>
  <text x="40" y="120" font-size="54" font-family="sans-serif" fill="black">商品清单</text>
  <text x="40" y="260" font-size="44" font-family="sans-serif" fill="black">可口可乐罐装 330ml</text>
  <text x="40" y="330" font-size="36" font-family="sans-serif" fill="black">数量 12 罐 保质期 2027-11-18</text>
  <text x="40" y="470" font-size="44" font-family="sans-serif" fill="black">青岛啤酒 500ml</text>
  <text x="40" y="540" font-size="36" font-family="sans-serif" fill="black">数量 6 罐 保质期 2027-05-01</text>
  <text x="40" y="680" font-size="44" font-family="sans-serif" fill="black">农夫山泉 550ml</text>
  <text x="40" y="750" font-size="36" font-family="sans-serif" fill="black">数量 24 瓶</text>
</svg>`);
await sharp(svg).png().toFile(imagePath);

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(BASE);
await page.waitForTimeout(1800);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
}
await dismissBlockingDialogs(page);

const aiAvailable = await page.evaluate(async () => {
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) return false;
    return Boolean((await response.json()).aiAvailable);
  } catch {
    return false;
  }
});

if (!aiAvailable) {
  console.log("      跳过批量识别草稿检查:本环境未配置 AI,识别不出草稿");
  await context.close();
  await browser.close();
  // 明确打印跳过,不让它看起来像通过
  process.exit(0);
}

const draftNames = () => page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return dialog ? [...dialog.querySelectorAll("details")].map((row) => (row.querySelector("summary span")?.textContent || "").trim()) : [];
});

try {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2200);
  await dismissBlockingDialogs(page);
  await page.locator('button[aria-label="AI 批量识别物品"]').first().click();
  await page.waitForTimeout(1400);
  await page.setInputFiles('[role="dialog"] input[type="file"]', imagePath);
  await page.waitForTimeout(1800);
  await page.locator('[role="dialog"] button:has-text("识别这批图片")').first().click();

  // AI 有延迟,最多等 90 秒
  let drafts = [];
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await page.waitForTimeout(5000);
    drafts = await draftNames();
    if (drafts.length >= 2) break;
  }
  check("这张图真的识别出了至少 2 条草稿(否则这一节等于没测)", drafts.length >= 2, `drafts=${drafts.length}`);

  if (drafts.length >= 2) {
    // 改成 A/B/C:能一眼看出「值跟不跟着行走」
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const names = ["A-甲", "B-乙", "C-丙", "D-丁", "E-戊", "F-己"];
      [...dialog.querySelectorAll("details")].forEach((row, index) => {
        const input = row.querySelector("input");
        if (!input || !names[index]) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, names[index]);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    await page.waitForTimeout(600);

    // 用键盘:聚焦中间那行的「移除此项」再回车
    const focused = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] details')];
      const button = [...rows[1].querySelectorAll("button")].find((node) => (node.textContent || "").includes("移除此项"));
      button.focus();
      return document.activeElement === button;
    });
    check("能用键盘聚焦中间那行的「移除此项」", focused);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const afterRemove = await draftNames();
    check("移除中间一条后,剩下的是首尾两条", afterRemove.length === drafts.length - 1 && afterRemove[0] === "A-甲" && afterRemove[1] === "C-丙", JSON.stringify(afterRemove));

    const focusState = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? null,
        rowName: (active?.closest?.("details")?.querySelector("summary span")?.textContent || "").trim(),
        insideDialog: Boolean(document.querySelector('[role="dialog"]')?.contains(active)),
      };
    });
    // 关键:焦点不能再落在那个「已经被换成别的物品」的移除按钮上
    check("移除后焦点落在相邻那条草稿上(不是被复用的移除按钮)", focusState.tag === "SUMMARY" && focusState.insideDialog, JSON.stringify(focusState));
    check("焦点所在的正是接替它的那条草稿", focusState.rowName === "C-丙", `focusRow=${focusState.rowName}`);

    // 再按一次回车:此前这里会把 C 也删掉
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const afterSecond = await draftNames();
    check("再按一次回车不会连带删掉下一条", afterSecond.length === afterRemove.length, `${JSON.stringify(afterRemove)} → ${JSON.stringify(afterSecond)}`);
  }
} finally {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  await context.close();
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);