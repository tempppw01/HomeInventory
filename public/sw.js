// 离线 Service Worker(阶段 1:离线看得见数据)。
//
// 这条取舍在本版**被有意改了**(2026-11-28,用户要求「没网时能离线缓存、有网时自动异步同步」):
//   · 旧版:只缓存外壳 + 静态资源,**绝不缓存 /api**;断网时导航 302 到 /offline 说一句「你没网了」。
//     理由是「家庭账目最忌讳拿旧数据做决定」。
//   · 新版:GET 类接口也缓存,**但**每份缓存响应都带上它是什么时候抓的(`x-guiwu-cached-at`),
//     界面据此显示「离线 · 数据是 M 分钟前的快照」。也就是说:**不再假装数据是新鲜的** ——
//     这条底线没丢,只是从「宁可什么都看不见」换成「看得见,但必须标明是快照」。
//   · 写入仍然**不在这里做**:离线改动由阶段 2 的待发队列(outbox)负责,SW 只负责读。
//
// 缓存策略一览:
//   /api/** GET        网络优先;成功即写缓存;断网回退缓存(并标上抓取时间)
//   导航(navigate)     网络优先;断网回退**这一页缓存过的 HTML**,再不行才去 /offline
//   /_next/static/**   缓存优先(内容哈希命名,不会过期)
const CACHE = "guiwu-shell-v4";
const API_CACHE = "guiwu-api-v1";
const OFFLINE_URL = "/offline";
const CACHED_AT = "x-guiwu-cached-at";

/** 预缓存离线页 **以及它自己要用的资源**。 */
async function precacheOfflineShell() {
  const cache = await caches.open(CACHE);
  // 预缓存「离线页 + 主要路由」。
  //
  // 为什么必须在 install 阶段抓主要路由:第一次访问的那次导航发生在 SW 接管之前,
  // 它**从没被缓存过** —— 只靠「导航时顺手缓存」的话,「上网打开过一次」并不足以让断网后看得见数据。
  // 2026-11-28 实测:掐网重载 /items 直接落到了离线页(回退链的最后一段)。
  for (const route of [OFFLINE_URL, "/", "/items"]) {
    const response = await fetch(route, { cache: "reload" });
    // 被重定向过的不收:未登录时 /items 会跳到登录页,若把它当 /items 存下来,
    // 离线打开 /items 就会看到登录表单 —— 那比「没缓存」更容易让人误会。
    if (!response.ok || response.redirected) continue;
    await cache.put(route, response.clone());
  }
  const offlineShell = await caches.match(OFFLINE_URL, { cacheName: CACHE });
  if (!offlineShell) return;
  const html = await offlineShell.clone().text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]))]
    .filter((path) => path.startsWith("/_next/") || /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(path));
  if (assets.length) await cache.addAll(assets).catch(() => undefined);
}

/**
 * 缓存一份成功响应,并**记下它是什么时候抓的**。
 *
 * 用响应头而不是单独的元数据表:缓存里存的就是用户真正会拿到的那份字节,
 * 时间跟着它走,不会出现「响应是新的、时间戳是旧的」这种对不上的情况。
 * 注意 `Cache-Control: no-store` 之类也不影响 —— 我们存的是自己的副本。
 */
async function cacheWithStamp(request, response) {
  if (!response || !response.ok) return response;
  const body = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, new Date().toISOString());
  const stamped = new Response(body, { status: response.status, statusText: response.statusText, headers });
  await caches.open(API_CACHE).then((cache) => cache.put(request, stamped.clone())).catch(() => undefined);
  // 返回**未加标记**的原始响应给页面:在线时它拿到的是服务器原样返回的东西,
  // 标记只用于离线回退,免得在线时界面也误以为这是缓存。
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOfflineShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== API_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口:网络优先,断网回退缓存(带抓取时间)。只缓存 200 的 GET —— 失败响应没有缓存价值。
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => cacheWithStamp(request, response))
        .catch(async () => {
          const cached = await caches.match(request, { cacheName: API_CACHE });
          if (cached) return cached;
          // 连缓存都没有:让页面照常拿到一个失败响应,它会显示「离线」而不是假装成功。
          return Response.error();
        }),
    );
    return;
  }

  // 静态资源:缓存优先。
  if (url.pathname.startsWith("/_next/static/") || /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      }).catch(() => cached).catch(() => Response.error())),
    );
    return;
  }

  // 页面导航:网络优先;断网时**回退这一页缓存过的 HTML**(有就整页可用),
  // 没有才退到 /offline 那句说明。
  //
  // 旧版在这里直接 302 到 /offline:于是「离线看得见数据」根本无从谈起 ——
  // 页面压根没机会加载,界面也就没机会显示快照横幅。现在先给缓存过的整页,
  // 页面自己会去拿缓存的接口数据,并标明那是快照。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request, { cacheName: CACHE });
          if (cachedPage) return cachedPage;
          const offlinePage = await caches.match(OFFLINE_URL, { cacheName: CACHE });
          return offlinePage ?? Response.error();
        }),
    );
  }
});
