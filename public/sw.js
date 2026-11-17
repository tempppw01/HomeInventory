// 离线只读 Service Worker。
//
// 设计取舍:
// - 只缓存「页面外壳 + 静态资源」,不缓存 /api 响应 —— 库存数据宁可显示「离线」,
//   也不要给用户看过期的数字(家庭账目最忌讳拿旧数据做决定)。
// - 导航请求走 network-first:有网时总是最新;断网时回退到缓存过的 shell。
// - 静态资源(chunk/css/字体)走 cache-first:内容哈希命名,不会过期。
const CACHE = "guiwu-shell-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL])).catch(() => undefined).then(() => self.skipWaiting()),
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

  // 页面导航:网络优先,断网回退离线页。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? (await caches.match(request)) ?? Response.error()),
    );
  }
});