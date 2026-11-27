import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SCAN_CONSUME_BLOCKER_MESSAGE, scanConsumeBlocker } from "@/lib/item-metrics";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { refreshConsumeRate } from "@/lib/consume-rate";
import { withWriteRetry } from "@/lib/write-retry";
import { apiError } from "@/lib/api";
import { clientAddress, rateLimit } from "@/lib/rate-limit";

const consumeSchema = z.object({ itemId: z.string().trim().min(1).max(80), requestId: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    // The QR consume endpoint is intentionally usable without a login, so it
    // needs its own guard: without it anyone reachable on the network could
    // drain stock by replaying the request with fresh ids.
    const guard = rateLimit(`public-consume:${clientAddress(request)}`, 30, 60_000);
    if (!guard.ok) {
      return NextResponse.json({ error: `扫码消耗操作过于频繁,请 ${guard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(guard.retryAfter) } });
    }
    const { itemId, requestId } = consumeSchema.parse(await request.json());
    // 同一个 requestId 的并发重复提交(手机重试、连点)在 MySQL 上会两边都读不到既有记录,
    // 于是都去扣库存,最后撞唯一约束 —— 实测其中一个直接 409「服务器错误」样式的失败,
    // 而「重试」本来就该是安全的。这里把唯一约束冲突当成「这条已经记过了」来处理。
    let result;
    try {
      result = await withWriteRetry(() => prisma.$transaction(async (tx) => {
      const previous = await tx.activityLog.findUnique({ where: { scanRequestId: requestId }, include: { item: { include: { location: true } } } });
      if (previous?.item) return { item: previous.item, duplicate: true as const };
      const current = await tx.item.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!current) return { error: "物品不存在", status: 404 as const };
      // 能不能按件消耗由 scanConsumeBlocker 一处判定,界面(src/components/consume-scan.tsx)
      // 拿的是同一个函数和同一份文案 —— 此前两边各写各的,界面漏了「耐用品」这一档。
      const blocker = scanConsumeBlocker(current);
      if (blocker) return { error: SCAN_CONSUME_BLOCKER_MESSAGE[blocker], status: 409 as const };

      const changed = await tx.item.updateMany({
        where: { id: itemId, deletedAt: null, type: "CONSUMABLE", quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      });
      if (changed.count !== 1) return { error: "库存不足，无法消耗", status: 409 as const };

      const item = await tx.item.findUniqueOrThrow({ where: { id: itemId }, include: { location: true } });
      await tx.activityLog.create({
        data: { action: "CONSUME", itemId: item.id, itemName: item.name, detail: `扫码消耗 1 ${item.unit}`, scanRequestId: requestId },
      });

      // 扫码也是真消耗,同样要进消耗速度:此前这条路完全不算 consumeRate,
      // 只用扫码的人「还能用几天 / 每月花费」永远学不到节奏(实测 3 次扫码后 rate 仍是 0)。
      await refreshConsumeRate(tx, item.id);
      // 与其他三个调用点共用一份「该不该建、要不要顺手清重复项」的逻辑。
      await ensureRestockSuggestion(tx, item);
      const updated = await tx.item.findUniqueOrThrow({ where: { id: itemId }, include: { location: true } });
      return { item: updated, duplicate: false as const };
    }));
    } catch (error) {
      // 唯一约束冲突 = 同一个 requestId 已经被另一个并发请求写进去了。
      // 对调用方来说这就是「已记过」,应该 200 回来,不该报错。
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : null;
      if (code !== "P2002") throw error;
      const existing = await prisma.activityLog.findUnique({ where: { scanRequestId: requestId }, include: { item: { include: { location: true } } } });
      if (!existing?.item) return NextResponse.json({ ok: true, item: null, consumed: 0, duplicate: true });
      result = { item: existing.item, duplicate: true as const };
    }

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, item: result.item, consumed: result.duplicate ? 0 : 1, duplicate: result.duplicate });
  } catch (error) {
    return apiError(error);
  }
}
