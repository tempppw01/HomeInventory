// 离线只读 Service Worker。
//
// 设计取舍:
// - 只缓存「页面外壳 + 静态资源」,不缓存 /api 响应 —— 库存数据宁可显示「离线」,
//   也不要给用户看过期的数字(家庭账目最忌讳拿旧数据做决定)。
// - 导航请求走 network-first:有网时总是最新;断网时回退到缓存过的 shell。
// - 静态资源(chunk/css/字体)走 cache-first:内容哈希命名,不会过期。
const CACHE = "guiwu-shell-v3";
const OFFLINE_URL = "/offline";

/**
 * 预缓存离线页 **以及它自己要用的资源**。
 *
 * 只缓存 /offline 那份 HTML 是不够的:离线时页面还要取它自己的 JS/CSS 分块,
 * 取不到就会在客户端渲染失败 —— 用户看到的是应用的错误页,而不是「你没网了」这句说明。
 * 这些分块以前只有在「碰巧被之前的浏览缓存过」时才在,所以这条时灵时不灵。
 */
async function precacheOfflineShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch(OFFLINE_URL, { cache: "reload" });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put(OFFLINE_URL, response.clone());
  // 从 HTML 里挑出同源静态资源(_next 分块、样式、字体、图标),一并放进缓存
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]))]
    .filter((path) => path.startsWith("/_next/") || /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(path));
  if (assets.length) await cache.addAll(assets).catch(() => undefined);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheOfflineShell().catch(() => undefined).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 接口永远走网络:离线时让页面自己显示「离线」,不返回过期数据。
  if (url.pathname.startsWith("/api/")) return;

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

  // 页面导航:网络优先;断网时**重定向**到离线页。
  //
  // 这里不要图省事把离线页的 HTML 直接当成当前地址的响应返回:那样浏览器仍按原地址
  // (例如 /items)处理,前端会照常去拉这一页的数据、失败,于是渲染出通用错误边界 ——
  // 用户看到的是「页面没能加载出来」,而不是离线页里写好的说明。
  // 重定向之后地址真的变成 /offline,该页本身已在安装时预缓存,离线也能打开。
  if (request.mode === "navigate") {
    const isOfflineRoute = url.pathname === OFFLINE_URL;
    event.respondWith(
      fetch(request).catch(async () => {
        if (isOfflineRoute) return (await caches.match(OFFLINE_URL)) ?? Response.error();
        return Response.redirect(OFFLINE_URL, 302);
      }),
    );
  }
});