"use client";

import { useEffect } from "react";

// 注册离线只读 Service Worker。只在生产环境注册:开发时缓存 shell 会让热更新失效。
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // 延迟到首屏空闲再注册,避免和首屏资源抢带宽。
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => void }).requestIdleCallback;
    if (idle) idle(register);
    else setTimeout(register, 3000);
  }, []);
  return null;
}