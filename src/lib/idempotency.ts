import { prisma } from "@/lib/prisma";

/**
 * 幂等:同一个 opId 只应用一次(阶段 2 的地基)。
 *
 * 为什么先做这件事:离线改动会在网络恢复时重放,而重放可能重复发送 —— 网络抖一下、页面刷新、
 * 用户手点重试都会。对「消耗 1 件」这种操作,重复一次就是**多消耗一件**:那不是显示问题,是数据少了。
 * 所以顺序是:**先把幂等做完,再开放离线写入**。
 *
 * 实现沿用这个仓库已有的先例(ActivityLog.scanRequestId:扫码消耗就是靠唯一请求号去重的),
 * 把它推广成通用的一把钥匙:客户端每个写操作带一个 opId,服务端见过就回上次的结果,不再落库。
 */

/** 只接受一段「看起来像操作号」的字符串;别的当没带(宁可不保护,也不接受任意内容进唯一键)。 */
export function normalizeOpId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length < 8 || value.length > 120) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

type OnceOutcome<T> = { replay: false; result: T } | { replay: true; result: T | null };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * 跑一次「只该生效一次」的操作。
 *
 * @param opId    客户端给的唯一操作号;为 null 时退化成普通调用(不做去重,也不记账)。
 * @param action  操作名,只用于排查(例如 item.consume)。
 * @param staleMs 标记在、结果不在时的宽限:超过它认为是「孤儿标记」(进程中途死掉),
 *                删掉重做;没超过就当作「上一次还在处理」,让调用方告诉用户稍后刷新。
 */
export async function runOnce<T>(
  opId: string | null,
  action: string,
  run: () => Promise<T>,
  options: { staleMs?: number } = {},
): Promise<OnceOutcome<T>> {
  if (!opId) return { replay: false, result: await run() };
  const staleMs = options.staleMs ?? 5 * 60_000;

  try {
    await prisma.syncOperation.create({ data: { opId, action } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const seen = await prisma.syncOperation.findUnique({ where: { opId } });
    if (seen?.resultJson) {
      try {
        return { replay: true, result: JSON.parse(seen.resultJson) as T };
      } catch {
        // 结果串坏了:宁可说「处理中」,也不重复执行一次
        return { replay: true, result: null };
      }
    }
    if (seen && Date.now() - seen.createdAt.getTime() > staleMs) {
      await prisma.syncOperation.delete({ where: { opId } }).catch(() => undefined);
      return runOnce(opId, action, run, options);
    }
    return { replay: true, result: null };
  }

  try {
    const result = await run();
    await prisma.syncOperation.update({ where: { opId }, data: { resultJson: JSON.stringify(result) } }).catch(() => undefined);
    return { replay: false, result };
  } catch (error) {
    // 这次没做成(校验失败、库存不足…):把标记删掉 ——
    // 否则重试会被自己上一次的标记挡在门外,变成「永远做不成」。
    await prisma.syncOperation.delete({ where: { opId } }).catch(() => undefined);
    throw error;
  }
}
