type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

/**
 * 限流计数。
 *
 * @param options.increment false = 只读(先判断"还能不能试"),真正的计数由调用方在**失败时**再记。
 *   为什么需要:登录限流如果连**成功登录**也计数,正常使用就会被误伤 ——
 *   实测 CI 里 25 个套件连着登录,把 10 分钟窗口打满后,后面的套件要等 345 秒;
 *   而攻击的特征是**反复失败**,不是"登录得多"。
 */
export function rateLimit(key: string, limit: number, windowMs: number, options: { increment?: boolean } = {}) {
  const now = Date.now();
  const current = buckets.get(key);
  const live = current && current.resetAt > now ? current : null;
  const count = live?.count ?? 0;
  const retryAfter = live ? Math.max(0, Math.ceil((live.resetAt - now) / 1000)) : 0;

  if (options.increment === false) {
    return { ok: count < limit, remaining: Math.max(0, limit - count), retryAfter: count < limit ? 0 : retryAfter };
  }
  if (!live) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }
  live.count += 1;
  return { ok: live.count <= limit, remaining: Math.max(0, limit - live.count), retryAfter };
}

/** 清掉某个 key 的计数(登录成功后,这个人已经用密码证明了自己)。 */
export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/**
 * 限流的「来源」标识。
 *
 * 实测(修之前):这里取的是 X-Forwarded-For 的**最左**值,而那个位置正是**客户端可以随便写**的 ——
 * 攻击者每次换一个 XFF 就能让登录限流完全失效:实测连续 15 次尝试、每次换一个地址,**0 次被拦**。
 * 直连部署(NAS、docker 端口映射,很常见)尤其如此。
 *
 * 现在取**最右**值:反向代理(nginx 的 $proxy_add_x_forwarded_for 之类)会把真实来源**追加**在末尾,
 * 所以最右是应用最近的那一跳看到的地址,客户端伪造不了(除非它就是最后一跳)。
 * 注意:直连部署时连最右也是客户端写的 —— 所以**关键接口还要有与来源无关的限流**
 * (登录就额外按账号计数,见 /api/auth/login),光靠 IP 挡不住。
 */
export function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
