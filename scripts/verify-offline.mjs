// 离线行为验收(Service Worker)。
//
// 这是此前「已知未覆盖」清单里的一条。产品的承诺写在 public/sw.js 与 /offline 页面里:
//   · 只缓存「页面外壳 + 静态资源」,**不缓存 /api 响应**
//   · 断网时给出**带时间戳的快照**(v0.1.120 起;此前是「只给说明页、不给任何数据」)。
//     这条契约在 2026-11-28 被有意改掉:用户要求「没网时能离线缓存」。底线换成另一种形式 ——
//     看得见,但必须标明是快照、是多久之前的;套件因此同时守两件事:数据在 **且** 标着时间。
//   · 什么都没有缓存(或缓存被清掉)时才退回 /offline 说明页。
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
// 注册发生在首屏空闲之后,接管还要等它 active。只刷一次不够稳 ——
// CI 冷缓存时实测漏过一次,断网导航就落到了通用错误页,报出来却是「说明页没解释原因」。
for (let attempt = 0; attempt < 5 && !state.controlled; attempt += 1) {
  await page.evaluate(() => ("serviceWorker" in navigator ? navigator.serviceWorker.ready.then(() => true).catch(() => false) : false));
  await page.reload();
  await page.waitForTimeout(2000);
  state = await swState();
}
check("注册了 Service Worker", Boolean(state.registered), JSON.stringify(state));
check("页面已被 Service Worker 接管", Boolean(state.controlled), `${JSON.stringify(state)} —— 没接管的话,下面断网导航会落到通用错误页,那两条断言不可信`);

// ---------- 1b 等预缓存就绪:离线页是在 install 阶段 cache.addAll 进去的 ----------
// 只等「接管」会在 CI 上偶发失败:SW 已经接管,但 /offline 还没写进缓存,
// 这时断网导航就会落到应用自己的错误页(实测红过两次)。
const offlineCacheState = async () => page.evaluate(async () => {
  if (!("caches" in window)) return { supported: false, names: [], hasOffline: false };
  const names = await caches.keys();
  let hasOffline = false;
  for (const name of names) {
    const cache = await caches.open(name);
    if (await cache.match("/offline")) { hasOffline = true; break; }
  }
  return { supported: true, names, hasOffline };
});

let cacheState = await offlineCacheState();
for (let attempt = 0; attempt < 10 && !cacheState.hasOffline; attempt += 1) {
  await page.waitForTimeout(500);
  cacheState = await offlineCacheState();
}
check("离线页已经进了 Service Worker 的缓存(断网导航才有东西可给)", cacheState.hasOffline, `缓存=${JSON.stringify(cacheState)}`);

// 记下一件在线时看得见的物品,断网后要确认它**不会**出现
const itemName = await page.evaluate(() => {
  const text = document.querySelector("main")?.innerText || "";
  const match = text.match(/[\u4e00-\u9fa5]{2,8}(胶囊|口罩|鲜奶|啤酒|汽水|山泉|酸奶|气雾剂)/);
  return match ? match[0] : null;
});
console.log(`      在线时列表里有:${itemName ?? "(没抓到物品名)"}`);

// ---------- 2 断网后导航:应留在这一页,并标出「这是快照」 ----------
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
// 新契约:断网后**保持这一页**(缓存整页 + 缓存的数据),不再跳到 /offline。
// 旧断言是 `url === "/offline"` —— 它守的是改掉之前的行为;改契约就得同步改断言,
// 否则 CI 会用一条「正确的旧断言」把新行为判成错的(2026-11-28 实测:v0.1.120 就是这么红掉的)。
check("断网后仍留在这一页(不再跳到离线页)", offline?.url === "/items", `实际地址=${offline?.url ?? "?"}`);
check("离线时看到了数据快照横幅", Boolean(offline?.text && /快照/.test(offline.text)), (offline?.text ?? "").slice(0, 200));
check("横幅说清了数据是多久之前的(不许假装新鲜)", Boolean(offline?.text && /上次同步/.test(offline.text)), (offline?.text ?? "").slice(0, 200));
check("横幅说明了恢复网络后会自动刷新", Boolean(offline?.text && /会自动刷新/.test(offline.text)), (offline?.text ?? "").slice(0, 200));

// ---------- 3 关键承诺(新契约):离线时**看得见**数据,但必须标明是快照 ----------
//
// 旧契约是「离线时不显示库存数据」;v0.1.120 有意改成「看得见 + 横幅标明时间」。
// 这条断言因此反过来了 —— 但它守的东西没变:不许让人**不知道**自己看的是旧数字。
if (itemName) {
  const showsItems = Boolean(offline?.text && offline.text.includes(itemName));
  check("离线时看得见缓存的数据(这是本版有意改掉的行为)", showsItems, `离线页里没有出现「${itemName}」`);
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