// 离线行为验收(Service Worker)。
//
// 这是此前「已知未覆盖」清单里的一条。产品的承诺写在 public/sw.js 与 /offline 页面里:
//   · 只缓存「页面外壳 + 静态资源」,**不缓存 /api 响应**
//   · 断网时给出说明页,而不是让人看到过期的库存数字
//     (家庭账目最忌讳拿旧数据做决定)
// 这里从用户视角验证:断网后能看到说明页、看不到旧数据、恢复网络后一切正常。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-offline.mjs

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

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  process.exit(1);
}

// ---------- ① Service Worker 注册与接管 ----------
await page.goto(`${BASE}/items`);
await page.waitForTimeout(2600);
await dismissBlockingDialogs(page);

const swState = async () => page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return { supported: false, registered: false, controlled: false };
  const registration = await navigator.serviceWorker.getRegistration();
  return { supported: true, registered: Boolean(registration), controlled: Boolean(navigator.serviceWorker.controller) };
});

let state = await swState();
if (state.registered && !state.controlled) {
  // 注册发生在首屏空闲之后;再刷一次让它在本次会话里接管页面
  await page.reload();
  await page.waitForTimeout(2600);
  state = await swState();
}
check("注册了 Service Worker", Boolean(state.registered), JSON.stringify(state));
check("页面已被 Service Worker 接管", Boolean(state.controlled), JSON.stringify(state));

// 记下一件在线时看得见的物品,断网后要确认它**不会**出现
const itemName = await page.evaluate(() => {
  const text = document.querySelector("main")?.innerText || "";
  const match = text.match(/[\u4e00-\u9fa5]{2,8}(胶囊|口罩|鲜奶|啤酒|汽水|山泉|酸奶|气雾剂)/);
  return match ? match[0] : null;
});
console.log(`      在线时列表里有:${itemName ?? "(没抓到物品名)"}`);

// ---------- ② 断网后导航:应落到离线说明页 ----------
//
// 关键:**另开一页**来导航。复用刚加载完的那一页会测到别的东西 ——
// 离线后那个页面自己的数据刷新会失败并触发错误边界,于是看到的是通用错误页,
// 而用户离线时真正做的是「重新打开应用」,也就是新开一页。
await context.setOffline(true);
const offlinePage = await context.newPage();
let offline = null;
try {
  await offlinePage.goto(`${BASE}/items`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await offlinePage.waitForTimeout(1500);
  offline = await offlinePage.evaluate(() => ({
    url: location.pathname,
    text: (document.body.innerText || "").replace(/\n+/g, " | ").slice(0, 300),
    hasReload: Boolean(Array.from(document.querySelectorAll("button, a")).find((node) => (node.textContent || "").includes("重新加载"))),
  }));
} catch (error) {
  offline = { error: error instanceof Error ? error.message.slice(0, 120) : String(error) };
}

check("断网后仍能看到页面(不是浏览器错误页)", Boolean(offline?.text || offline?.hasReload), JSON.stringify(offline).slice(0, 160));
check("断网后落到离线说明页(地址变成 /offline)", offline?.url === "/offline", `实际地址=${offline?.url ?? "?"}`);
check("说明页解释了为什么看不到数据", Boolean(offline?.text && /没有网络|离线/.test(offline.text)), (offline?.text ?? "").slice(0, 160));
check("提供了重新加载的入口", Boolean(offline?.hasReload), (offline?.text ?? "").slice(0, 160));

// ---------- ③ 关键承诺:离线时不显示过期数据 ----------
if (itemName) {
  const showsStale = Boolean(offline?.text && offline.text.includes(itemName));
  check("离线时不显示库存数据(避免拿旧数字做决定)", !showsStale, `离线页里出现了「${itemName}」`);
} else {
  console.log("      跳过「离线不显示库存数据」:在线时没抓到物品名,无法比对");
}

// ---------- ④ 恢复网络后回到可用状态 ----------
await context.setOffline(false);
await offlinePage.goto(`${BASE}/items`, { waitUntil: "domcontentloaded", timeout: 20000 });
await offlinePage.waitForTimeout(2800);
const online = await offlinePage.evaluate(() => ({
  // 注意:这里不要截断 —— 截到 200 字再去找物品名,会把自己骗过去(物品排在后面就搜不到)。
  text: (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "),
  hasItems: Boolean(document.querySelector('main button[aria-label="更多操作"]')),
}));
check("恢复网络后能正常加载列表", online.hasItems || /物品|库存/.test(online.text), online.text);
if (itemName) {
  check("恢复网络后数据回来了", online.text.includes(itemName), `没看到「${itemName}」`);
}

await offlinePage.close();
await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);