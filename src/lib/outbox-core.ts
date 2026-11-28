// 离线待发队列的「纯」部分:操作长什么样、什么该重试、重试等多久。
//
// 为什么单独一个文件:队列本身要碰 IndexedDB(那是 I/O,不好单测),但**决策**是纯的 ——
// 一个失败响应该不该重试、下一次该等多久、队列里有几条待发。这些错了,后果很具体:
// 把 400(校验不过)当可重试,队列会永远卡在一个做不成的操作上;
// 把网络错当即时失败,用户的离线改动就白做了。
//
// 幂等键沿用服务端那把钥匙(x-guiwu-op-id,见 lib/idempotency 与 SyncOperation 表):
// 重放时带同一个 opId,服务端见过就回上次的结果,不会多扣一件。

export type OutboxMethod = "POST" | "PATCH" | "DELETE";

export type OutboxOperation = {
  /** 幂等键;服务端据此去重 */
  opId: string;
  method: OutboxMethod;
  url: string;
  body: unknown;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** 界面上说清「这是什么操作」(例如「消耗 1 件 · 可口可乐」) */
  label: string;
};

/** 8–120 位、只含 [A-Za-z0-9._:-] —— 与 lib/idempotency 的 normalizeOpId 白名单一致。 */
export function makeOpId(now = Date.now(), random: () => number = Math.random): string {
  const tail = Math.floor(random() * 0xffffffff).toString(36);
  const mid = Math.floor(random() * 0xffff).toString(36);
  return `offline:${now.toString(36)}:${mid}:${tail}`;
}

export function makeOperation(
  input: { method: OutboxMethod; url: string; body?: unknown; label: string },
  now = Date.now(),
  random: () => number = Math.random,
): OutboxOperation {
  return {
    opId: makeOpId(now, random),
    method: input.method,
    url: input.url,
    body: input.body ?? null,
    createdAt: now,
    attempts: 0,
    lastError: null,
    label: input.label,
  };
}

/**
 * 这次失败该不该重试?
 *
 * @param status HTTP 状态码;`null` 表示根本没拿到响应(断网、请求被掐) —— 那是**最该重试**的一种。
 * 4xx 一律不重试(除了 408 请求超时、429 太频繁):校验不过的请求,重试一百次还是不过,
 * 只会把队列卡死在第一位、让后面的操作永远发不出去。
 */
export function isRetryable(status: number | null): boolean {
  if (status === null) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/** 指数退避:1s、2s、4s… 上限 60s。attempts 从 0 开始。 */
export function nextDelayMs(attempts: number): number {
  const base = 1000;
  const capped = Math.min(Math.max(attempts, 0), 6);
  return Math.min(base * 2 ** capped, 60_000);
}

/** 待发(还没成功)的条数 —— 徽章上显示的就是它。 */
export function pendingCount(queue: readonly OutboxOperation[]): number {
  return queue.length;
}

/** 队列里最老的一条:重放要按顺序来,不然「先建后改」会乱。 */
export function oldest(queue: readonly OutboxOperation[]): OutboxOperation | null {
  return queue.reduce<OutboxOperation | null>((best, row) => (!best || row.createdAt < best.createdAt ? row : best), null);
}
