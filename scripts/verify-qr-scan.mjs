// 扫码盘点验收(不需要摄像头)。
//
// 背景:扫码依赖浏览器的 BarcodeDetector,而它只有 Chromium 系支持 ——
// Firefox / Safari 一直没有,部分桌面 Chrome 上也不可用。没有兜底时,
// 「扫码盘点」在这些浏览器里等于不存在,用户只能在「手动」里敲编号。
//
// 现在加了随包携带的纯 JS 解码器(jsQR,按需加载)兜底。这条检查验证:
//   · 在**没有** BarcodeDetector 的环境里,「图片」扫描依然能识别出二维码
//   · 识别结果真的驱动了盘点进度(不是只弹个提示)
//   · 用的是应用**自己生成的**二维码:把二维码弹窗里的 SVG 栅格化成 PNG 再喂回去
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-qr-scan.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

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

// ---------- 环境:证实走的是「没有 BarcodeDetector」的兜底路径 ----------
const env = await page.evaluate(() => ({ hasBarcodeDetector: typeof globalThis.BarcodeDetector !== "undefined" }));
console.log(`      浏览器是否有 BarcodeDetector:${env.hasBarcodeDetector ? "有(走原生)" : "没有(走 jsQR 兜底)"}`);

// ---------- ① 用应用自己的二维码:把弹窗里的 SVG 栅格化成 PNG ----------
await page.goto(`${BASE}/items`);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);
await page.locator('main button[aria-label="更多操作"]').first().click({ button: "right" });
await page.waitForTimeout(800);
await page.locator('[role="menuitem"]:has-text("显示二维码")').first().click();
await page.waitForTimeout(1200);

const qr = await page.evaluate(async () => {
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getBoundingClientRect().height > 0).pop();
  // 弹窗里有三个 SVG:关闭图标、二维码、打印图标。
  // 直接取第一个会拿到「关闭」那个 ✗ 图标 —— 我第一次就是这么写错的(解不出码)。
  const svgs = Array.from(dialog?.querySelectorAll("svg") ?? []);
  const svg = svgs
    .filter((node) => !(node.getAttribute("class") || "").includes("lucide"))
    .sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0];
  if (!svg) return { ok: false };
  const code = (dialog?.innerText || "").match(/INV-\d{8}-[0-9A-Z]{6}/)?.[0] ?? null;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svgText = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
  });
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  const context2d = canvas.getContext("2d");
  // 四周留白(quiet zone):二维码规范要求留白,缺了会让解码器读不出
  context2d.fillStyle = "#ffffff";
  context2d.fillRect(0, 0, 480, 480);
  context2d.drawImage(image, 40, 40, 400, 400);
  return { ok: true, code, pngBase64: canvas.toDataURL("image/png").split(",")[1] };
});

check("能拿到应用自己生成的二维码", Boolean(qr.ok && qr.pngBase64), "二维码弹窗里没取到 SVG");
await page.keyboard.press("Escape");
await page.waitForTimeout(700);

// ---------- ② 盘点页:用「图片」模式扫码 ----------
await page.goto(`${BASE}/audit`);
await page.waitForTimeout(2800);
await dismissBlockingDialogs(page);

const progressOf = async () => {
  const text = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "));
  const match = /进度 (\d+) \/ (\d+)/.exec(text);
  return match ? Number(match[1]) : null;
};

const before = await progressOf();
console.log(`      扫码前盘点进度:${before ?? "?"}`);

const scanEntry = page.locator('button[aria-label="扫码盘点"]:visible').first();
check("盘点页有扫码入口", (await scanEntry.count()) === 1, "没找到扫码按钮");

if ((await scanEntry.count()) === 1 && qr.pngBase64) {
  await scanEntry.click();
  await page.waitForTimeout(1300);

  const imageChip = page.locator('[role="dialog"] button:has-text("图片")').first();
  check("扫码弹窗里有「图片」模式", (await imageChip.count()) > 0, "没找到「图片」按钮");

  if ((await imageChip.count()) > 0) {
    await imageChip.click();
    await page.waitForTimeout(700);

    const fileInput = page.locator('[role="dialog"] input[type="file"]').first();
    check("「图片」模式下有文件选择入口", (await fileInput.count()) > 0, "没找到 file input");

    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles({
        name: "qr.png",
        mimeType: "image/png",
        buffer: Buffer.from(qr.pngBase64, "base64"),
      });
      await page.waitForTimeout(2800);

      const dialogText = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getBoundingClientRect().height > 0);
        return dialogs.length ? (dialogs[dialogs.length - 1].innerText || "").replace(/\n+/g, " | ") : "";
      });
      check("识别没有落到「浏览器不支持」", !/不支持自动识别/.test(dialogText), dialogText.slice(0, 160));

      await page.keyboard.press("Escape");
      await page.waitForTimeout(1600);
      const after = await progressOf();
      check("扫码后盘点进度推进了", before !== null && after !== null && after > before, `前=${before} 后=${after}`);
    }
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);