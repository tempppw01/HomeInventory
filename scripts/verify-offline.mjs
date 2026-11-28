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

// ---------- 0b 准备一条"还没接队列"的写操作对象 ----------
// 队列目前接了三个动作(用掉 / 加入采购清单 / 录入物品),打勾(PATCH 采购项)仍然是直发。
// 3b-3 要在断网时点它一下,看界面是否如实说"还没保存" —— 所以先在线建一条。
const sentinelShoppingName = `离线只读检查-${Date.now().toString().slice(-6)}`;
let sentinelShoppingId = "";
{
  const created = await page.evaluate(async (name) => {
    const response = await fetch("/api/shopping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, quantity: 1, unit: "个", priority: 1, source: "manual" }) });
    const body = await response.json().catch(() => null);
    return { status: response.status, id: body?.item?.id ?? body?.id ?? null };
  }, sentinelShoppingName);
  sentinelShoppingId = created.id ?? "";
  check("准备了待打勾的采购项(3b-3 要用它)", created.status === 201 && Boolean(sentinelShoppingId), JSON.stringify(created));
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
  let hasDashboard = false;
  for (const name of names) {
    const cache = await caches.open(name);
    if (await cache.match("/api/dashboard")) { hasDashboard = true; break; }
  }
  return { supported: true, names, hasOffline, hasDashboard };
});

let cacheState = await offlineCacheState();
// 同时等 /api/dashboard 进缓存:断网时「看得见数据」全靠它(2026-11-28 CI 实测:只有外壳没有数据)。
for (let attempt = 0; attempt < 10 && (!cacheState.hasOffline || !cacheState.hasDashboard); attempt += 1) {
  await page.waitForTimeout(500);
  cacheState = await offlineCacheState();
}
check("离线页已经进了 Service Worker 的缓存(断网导航才有东西可给)", cacheState.hasOffline, `缓存=${JSON.stringify(cacheState)}`);
check("离线数据快照已经缓存(/api/dashboard)—— 断网时才看得见数据", cacheState.hasDashboard, `缓存=${JSON.stringify(cacheState)}`);

// 记下一件在线时看得见的物品,断网后要确认它**不会**出现
// 在线时看得见什么:**件数**当主依据(卡片/列表两种显示模式下都有「N 件」),
// 名字只从**真实渲染出来的行**取 —— 整页文本里可能混进「已用完」物品的名字,
// 而它们按设计不显示,拿它做断言必然失败(2026-11-28 CI 实测:抓到「已过期酸奶」,
// 而缓存快照 11 件、页面列表 9 件,正是那两件已用完的)。
const captured = await page.evaluate(() => {
  const text = document.querySelector("main")?.innerText || "";
  const countMatch = text.match(/(\d+)\s*件/);
  const button = document.querySelector('button[aria-label^="上传「"]');
  const label = button?.getAttribute("aria-label") || "";
  const name = label.replace(/^上传「/, "").replace(/」的照片$/, "").trim();
  return { count: countMatch ? countMatch[1] : null, name: name || null };
});
const itemName = captured.name;
const listCount = captured.count;
console.log(`      在线时列表里有:${itemName ?? "(没抓到物品名)"};计数=${listCount ?? "(没抓到 N 件)"}`);

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
  // 等数据渲染出来,而不是固定等 1.5 秒:断网时页面先出外壳,客户端再拿缓存快照渲染。
  // CI 的机器明显更慢(本机 13/13 通过、CI 却抓不到那件物品),固定等待会把「还没渲染完」判成「看不见数据」。
  // 这里等的是同一件事完成 —— 10 秒后仍没有,下面的断言照旧失败。
  await offlinePage
    .waitForFunction(
      (name) => {
        const text = document.querySelector("main")?.innerText || "";
        return name ? text.includes(name) : text.includes("快照");
      },
      itemName,
      { timeout: 10000 },
    )
    .catch(() => undefined);
  offline = await offlinePage.evaluate(async () => ({
    // 失败时自报家底:别让下一个人再靠猜(CI 那两次红就是这么猜出来的)。
    online: navigator.onLine,
    cachedItems: await (async () => {
      try {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          const hit = await cache.match("/api/dashboard");
          if (hit) { const body = await hit.json(); return Array.isArray(body?.items) ? body.items.length : -1; }
        }
      } catch { return -2; }
      return -3;
    })(),
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
const showsCount = Boolean(listCount && offline?.text && offline.text.includes(`${listCount} 件`));
// 主断言:断网后列表里**仍是同样的件数** —— 与「卡片显示 / 列表显示」无关,也不依赖具体是哪一件。
check(
  `离线时列表里仍是 ${listCount ?? "?"} 件(数据看得见)`,
  showsCount,
  `online=${offline?.online} · 缓存快照件数=${offline?.cachedItems} · 页面=${(offline?.text ?? "").slice(0, 220)}`,
);
if (itemName) {
  check("离线时看得见在线时那件物品", Boolean(offline?.text && offline.text.includes(itemName)), `没出现「${itemName}」`);
} else {
  console.log("      跳过「离线看得见那件物品」:在线时没抓到具体物品名(列表显示模式下没有卡片按钮)");
}

/** 这一轮离线新建的采购项名字(同步后要核对、并清理掉)。 */
let shoppingNameForCleanup = "";

/** 这一轮离线新建的物品名字(同步后要核对、并清理掉)。 */
let itemNameForCleanup = "";

/** 队列里现在有几条(离线队列存在 IndexedDB,套件直接读它 —— 比看徽章更硬)。 */
const outboxRows = () => offlinePage.evaluate(async () => {
  try {
    const names = (await indexedDB.databases()).map((db) => db.name);
    const name = names.find((it) => it && /outbox/i.test(it));
    if (!name) return -1;
    return await new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        const db = request.result;
        const store = [...db.objectStoreNames].find((it) => /op/i.test(it)) || db.objectStoreNames[0];
        const all = db.transaction(store, "readonly").objectStore(store).getAll();
        all.onsuccess = () => resolve(all.result.length);
        all.onerror = () => resolve(-2);
      };
      request.onerror = () => resolve(-2);
    });
  } catch { return -3; }
});

/**
 * toast 要"收集"而不是"某一刻读一眼":它是 2~4 秒就走的浮层,
 * 断言晚一点点就会读到空 —— 那是把自己骗过去(2026-11-28 实测:就因为这个误判过一次)。
 * 装一个 role=status/alert 的观察器,把出现过的文字都留下来。
 */
const startToastCollector = () => offlinePage.evaluate(() => {
  window.__guiwuToasts = [];
  const collect = () => {
    document.querySelectorAll('[role="status"],[role="alert"]').forEach((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text && !window.__guiwuToasts.includes(text)) window.__guiwuToasts.push(text);
    });
  };
  collect();
  if (window.__guiwuToastObserver) window.__guiwuToastObserver.disconnect();
  window.__guiwuToastObserver = new MutationObserver(collect);
  window.__guiwuToastObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
});
const collectedToasts = () => offlinePage.evaluate(() => (window.__guiwuToasts || []).join(" ｜ "));

/** 每个动作前清空收集器 —— 否则上一步的 toast 会让下一步的断言「假装通过」。 */
const resetToasts = () => offlinePage.evaluate(() => { window.__guiwuToasts = []; });

/**
 * 等一条符合样式的提示出现(最多轮询 5 秒)。
 * 为什么不是「读一眼」也不是「只靠观察器」:提示可能被紧接着的另一次 setToast 顶掉,
 * 也可能在观察器回调时还没布局 —— 两种都会把「确实提示了」误判成「没提示」。
 */
const waitForToast = async (pattern, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await offlinePage.evaluate(() => Array.from(document.querySelectorAll('[role="status"],[role="alert"]')).map((node) => (node.textContent || "")).join(" | "));
    if (pattern.test(text)) return text;
    await offlinePage.waitForTimeout(200);
  }
  return await collectedToasts();
};

/** 页面正文,但把 toast 的文字剔掉 —— 判"清单里有没有它"时不能把提示自己的话算进来。 */
const pageTextWithoutToasts = () => offlinePage.evaluate(() => {
  let text = (document.body.innerText || "").replace(/\s+/g, " ");
  (window.__guiwuToasts || []).forEach((toast) => { text = text.split(toast).join(" "); });
  return text;
});

/** 在弹窗里填第一个文本输入,并点**指定的那个**按钮(按文字精确匹配)。 */
const submitDialog = (name, exactButtonText) => offlinePage.evaluate(({ value, label }) => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return false;
  const input = dialog.querySelector('form input:not([type="number"])') || dialog.querySelector("input:not([type='number'])");
  if (!input) return false;
  // React 受控输入:必须走原生 setter + input 事件,否则组件读不到这个值
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const target = Array.from(dialog.querySelectorAll("button")).find((node) => (node.textContent || "").replace(/\s+/g, "") === label);
  if (!target) return false;
  target.click();
  return true;
}, { value: name, label: exactButtonText });

/** 关掉当前弹窗(取消/关闭),别影响后面的步骤。 */
const closeDialog = async () => {
  await offlinePage.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return;
    const button = Array.from(dialog.querySelectorAll("button")).find((node) => ["取消", "关闭"].includes((node.textContent || "").replace(/\s+/g, "")) || node.getAttribute("aria-label") === "关闭");
    if (button) button.click();
  });
  await offlinePage.waitForTimeout(400);
};

/** 打开一个入口按钮(按文字精确匹配)。 */
const clickByText = (label) => offlinePage.evaluate((text) => {
  const button = Array.from(document.querySelectorAll("button, a")).find((node) => (node.textContent || "").replace(/\s+/g, "") === text);
  if (!button) return false;
  button.click();
  return true;
}, label);

// ---------- 3b 离线写:接进队列的动作要"记得住、能同步";没接的动作不许假装成功 ----------
//
// 两条路必须说**不同的话**,而且都要与事实对得上:
//   · 「录入物品」还没接队列(2026-11-28 只接了「用掉」与「加入采购清单」)——
//     离线时必须说"这一项还没保存",队列不许增加,列表里不许出现。
//     以前它说的是「网络响应不完整,请重试;已保存的内容不会丢失」:原因说错(是没网)、承诺说过头(什么都没存)。
//   · 「加入采购清单」已接队列 —— 离线时要说"已记下,联网后自动加入",队列必须**真的 +1**,
//     而且离线期间**不许**假装它已经进了清单;恢复网络后必须**恰好一条**(重放不能多建、也不许翻倍)。
await startToastCollector();
{
  const queuedBefore = await outboxRows();

  // ---- 3b-1 没接队列的动作:录入物品(保存按钮的文字是「快速保存」,别用 /保存/ 去模糊匹配) ----
  const offlineItemName = `离线验收物品-${Date.now().toString().slice(-6)}`;
  itemNameForCleanup = offlineItemName;
  let itemMessage = "";
  try {
    if (!(await clickByText("录入物品"))) throw new Error("没找到「录入物品」入口");
    await offlinePage.waitForTimeout(1400);
    await resetToasts();
    if (!(await submitDialog(offlineItemName, "快速保存"))) throw new Error("没找到录入弹窗里的名称输入框或「快速保存」按钮");
    await offlinePage.waitForTimeout(2500);
    itemMessage = await waitForToast(/已记下/);
  } catch (error) {
    itemMessage = "没量到:" + (error instanceof Error ? error.message.slice(0, 90) : String(error).slice(0, 90));
  }
  check("离线录入:说清了「已记下,联网后自动录入」", /已记下/.test(itemMessage), itemMessage.slice(0, 220));
  check("离线录入:没有说「已保存」(它只是记在了本机队列)", !/已保存/.test(itemMessage), itemMessage.slice(0, 220));
  const queuedAfterItem = await outboxRows();
  check("离线录入:队列真的多了一条(话与事实一致)", queuedAfterItem === queuedBefore + 1, `队列 ${queuedBefore} → ${queuedAfterItem}`);
  const itemListedOffline = (await pageTextWithoutToasts()).includes(offlineItemName);
  check("离线期间没有假装它已经录进列表", !itemListedOffline, "离线时页面(提示之外)不该出现这件物品");
  await closeDialog();

  // ---- 3b-2 已接队列的动作:加入采购清单 ----
  const offlineShoppingName = `离线验收采购-${Date.now().toString().slice(-6)}`;
  shoppingNameForCleanup = offlineShoppingName;
  let shoppingMessage = "";
  try {
    if (!(await clickByText("添加采购项"))) throw new Error("没找到「添加采购项」入口");
    await offlinePage.waitForTimeout(1100);
    await resetToasts();
    if (!(await submitDialog(offlineShoppingName, "加入清单"))) throw new Error("没找到采购弹窗里的名称输入框或「加入清单」按钮");
    await offlinePage.waitForTimeout(2600);
    shoppingMessage = await waitForToast(/已记下/);
  } catch (error) {
    shoppingMessage = "没量到:" + (error instanceof Error ? error.message.slice(0, 90) : String(error).slice(0, 90));
  }
  check("离线加入采购清单:说清了「已记下,联网后自动加入」", /已记下/.test(shoppingMessage), (await collectedToasts()).slice(0, 220));
  check("离线加入采购清单:没有说「已保存」(它只是记在了本机队列)", !/已保存/.test(shoppingMessage), shoppingMessage.slice(0, 220));
  const queuedAfterShopping = await outboxRows();
  check("离线加入采购清单:队列真的多了一条(话与事实一致)", queuedAfterShopping === queuedAfterItem + 1, `队列 ${queuedBefore} → ${queuedAfterShopping}`);
  const listedOffline = (await pageTextWithoutToasts()).includes(offlineShoppingName);
  check("离线期间没有假装它已经在清单里", !listedOffline, "离线时页面(提示之外)不该出现这条");
}


  // ---- 3b-3 还没接队列的动作:给采购项打勾(PATCH) ----
  // 队列现在接了三个动作(用掉 / 加入采购清单 / 录入物品),但**别的动作仍然是直发**。
  // 断网时点它,必须说清"这一项还没保存",而且队列不许增加 —— 否则用户会以为打勾成功了。
  const queuedBeforeToggle = await outboxRows();
  let toggleMessage = "";
  try {
    await resetToasts();
    const clicked = await offlinePage.evaluate((name) => {
      // 找到这一行采购项,点它自己的那颗勾(行内的第一个按钮)
      const row = Array.from(document.querySelectorAll("li, div, article")).find((node) => {
        if (!(node.textContent || "").includes(name)) return false;
        return Boolean(node.querySelector("button"));
      });
      if (!row) return false;
      const button = row.querySelector("button");
      if (!button) return false;
      button.click();
      return true;
    }, sentinelShoppingName);
    if (!clicked) throw new Error("没找到那条采购项的打勾按钮");
    await offlinePage.waitForTimeout(2500);
    toggleMessage = await waitForToast(/离线/);
  } catch (error) {
    toggleMessage = "没量到:" + (error instanceof Error ? error.message.slice(0, 90) : String(error).slice(0, 90));
  }
  check("离线打勾(还没接队列的动作):说清了是离线、还没保存", /离线/.test(toggleMessage), toggleMessage.slice(0, 200));
  check("离线打勾:没有说「已保存」", !/已保存/.test(toggleMessage), toggleMessage.slice(0, 200));
  const queuedAfterToggle = await outboxRows();
  check("离线打勾:队列没有增加(它还没接队列)", queuedAfterToggle === queuedBeforeToggle, `队列 ${queuedBeforeToggle} → ${queuedAfterToggle}`);

// ---------- 4 恢复网络后回到可用状态 ----------
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

// ---------- 4b 恢复网络后:队列自己清空,采购项恰好一条(重放不能多建、也不能翻倍) ----------
{
  let rows = -1;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    rows = await outboxRows();
    if (rows === 0) break;
    await offlinePage.waitForTimeout(1000);
  }
  check("恢复网络后队列自动清空(离线记下的改动都发出去了)", rows === 0, `队列还剩 ${rows} 条`);

  const snapshot = await offlinePage.evaluate(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const body = await response.json();
    return (body.shopping ?? []).map((row) => ({ id: row.id, name: row.name, quantity: row.quantity, unit: row.unit }));
  });
  const mine = snapshot.filter((row) => row.name === shoppingNameForCleanup);
  check("同步后采购清单里**恰好一条**(重放没有多建)", mine.length === 1, `名字=${shoppingNameForCleanup} 命中=${JSON.stringify(mine).slice(0, 160)}`);
  check("同步后数量还是 1(重放没有翻倍)", mine.length === 1 && mine[0].quantity === 1, JSON.stringify(mine[0] ?? {}).slice(0, 120));

  // 收尾:删掉这次验收造的那条,别留给后面的套件(CI 有「跑完不留数据」这一关)
  if (mine.length === 1) {
    const status = await offlinePage.evaluate(async (id) => {
      const response = await fetch(`/api/shopping/${id}`, { method: "DELETE" });
      return response.status;
    }, mine[0].id);
    check("验收数据已清理(删掉那条采购项)", status === 200 || status === 204, `status=${status}`);
    const after = await offlinePage.evaluate(async (name) => {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const body = await response.json();
      return (body.shopping ?? []).filter((row) => row.name === name).length;
    }, shoppingNameForCleanup);
    check("清理干净:清单里已经没有那条了", after === 0, `还剩 ${after} 条`);
  }

  // 离线记下的「录入物品」:同步后必须**恰好一件**(重放不能多录)
  const items = await offlinePage.evaluate(async (name) => {
    const response = await fetch("/api/items?includeDeleted=1", { cache: "no-store" });
    const body = await response.json();
    const rows = Array.isArray(body) ? body : (body.items ?? []);
    return rows.filter((row) => row.name === name).map((row) => ({ id: row.id, name: row.name, quantity: row.quantity }));
  }, itemNameForCleanup);
  check("同步后新建的物品**恰好一件**(重放没有多录)", items.length === 1, `名字=${itemNameForCleanup} 命中=${JSON.stringify(items).slice(0, 160)}`);

  // 收尾:把这轮造的三样都清掉(新增物品 / 那条采购项 / 用来验打勾的采购项)
  const cleanup = [];
  if (items.length === 1) {
    cleanup.push(await offlinePage.evaluate(async (id) => {
      const response = await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) });
      return `物品=${response.status}`;
    }, items[0].id));
  }
  cleanup.push(await offlinePage.evaluate(async (id) => {
    const response = await fetch(`/api/shopping/${id}`, { method: "DELETE" });
    return `打勾用采购项=${response.status}`;
  }, sentinelShoppingId));
  check("验收数据已清理(新增的物品 + 两条采购项)", cleanup.every((entry) => /=(200|204)$/.test(entry)), cleanup.join(" · "));

  const leftovers = await offlinePage.evaluate(async ({ itemName, shoppingName }) => {
    const [itemsResponse, dashboardResponse] = await Promise.all([fetch("/api/items?includeDeleted=1", { cache: "no-store" }), fetch("/api/dashboard", { cache: "no-store" })]);
    const itemsBody = await itemsResponse.json();
    const rows = Array.isArray(itemsBody) ? itemsBody : (itemsBody.items ?? []);
    const dashboard = await dashboardResponse.json();
    return {
      items: rows.filter((row) => row.name === itemName).length,
      shopping: (dashboard.shopping ?? []).filter((row) => row.name === shoppingName).length,
    };
  }, { itemName: itemNameForCleanup, shoppingName: sentinelShoppingName });
  check("清理干净:列表里已经没有验收数据", leftovers.items === 0 && leftovers.shopping === 0, JSON.stringify(leftovers));
}


await offlinePage.close();
await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);