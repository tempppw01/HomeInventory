// 写事务撞车时的重试。
//
// 由来(MySQL 实测):同一件液体的余量被并发下调时,两个事务都「先读后写」同一行,
// MySQL 用行锁,于是其中一个被判定死锁并抛错 —— 接口没有处理,用户看到的是
// **500 服务器错误**(实测 3 个并发里 2 个 500)。SQLite 上不会出现,因为它的写事务天然串行,
// 所以这个缺陷在 SQLite-only 的检查里永远露不出来。
//
// 死锁不是「代码写错」,而是并发写同一行时的正常现象:正确做法是**有界重试**。
// 只重试明确属于「撞车」的错误码,别把真正的业务错误也重试一遍。

/** Prisma 把 MySQL 的死锁/写冲突与 SQLite 的 BUSY 都归到 P2034。 */
function isContention(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2034") return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /deadlock|lock wait timeout|database is locked|SQLITE_BUSY/i.test(message);
}

/**
 * 执行一次写事务;遇到死锁/写冲突时有界重试。
 * @param action 真正的事务体
 * @param attempts 最多尝试次数(含第一次)
 */
export async function withWriteRetry<T>(action: () => Promise<T>, attempts: number = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!isContention(error) || attempt === attempts) throw error;
      lastError = error;
      // 错开一点再试:同时重试还会再撞一次。
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.floor(Math.random() * 20)));
    }
  }
  throw lastError ?? new Error("write retry failed");
}

export { isContention };