import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shoppingSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { normalizedPurchaseName } from "@/lib/shopping-list";
import { normalizeOpId, runOnce } from "@/lib/idempotency";

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const data = shoppingSchema.parse(await request.json());
    // 客户端(含离线队列重放)带的唯一操作号:同一个号只建一次。
    // 这条路径尤其需要它 —— 离线时记下的采购项会在恢复网络后重放,
    // 而"加一条采购项"重复一次就是清单里多一条,用户得自己去删。
    const opId = normalizeOpId(request.headers.get("x-guiwu-op-id"));
    const outcome = await runOnce(opId, "shopping.create", () => prisma.$transaction(async (tx) => {
      // A shopping list should stay useful at a glance. Merge only entries
      // with the same normalised name *and* unit, so "2 bottles" is never
      // accidentally combined with "2 boxes".
      // 归一的写法收口在 lib/shopping-list:界面判定「在不在清单里」必须与这里的键完全一致,
      // 否则又会出现「界面说没有、点下去被合并(数量翻倍)」这种两处不一样的说法。
      const normalizedName = normalizedPurchaseName(data.name);
      const pending = await tx.shoppingItem.findMany({ where: { status: "PENDING", unit: data.unit } });
      const existing = pending.find((entry) => normalizedPurchaseName(entry.name) === normalizedName);
      if (existing) {
        const item = await tx.shoppingItem.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + data.quantity,
            priority: Math.max(existing.priority, data.priority),
            category: existing.category || data.category,
          },
        });
        await tx.activityLog.create({ data: { action: "SHOPPING_MERGE", itemName: item.name, userId: user.id, detail: "合并重复采购项" } });
        return { item, merged: true };
      }
      const item = await tx.shoppingItem.create({ data });
      await tx.activityLog.create({ data: { action: "SHOPPING_CREATE", itemName: item.name, userId: user.id, detail: "添加采购项" } });
      return { item, merged: false };
    }));
    if (outcome.replay) {
      // 重放:上次已经做过。有结果就原样回他(多一个 deduplicated 标记),
      // 结果还没写回来就说清楚 —— **绝不重复建一条**。
      if (outcome.result) return NextResponse.json({ ...outcome.result, deduplicated: true });
      return NextResponse.json({ error: "这条采购项已经在添加了,请稍后刷新", deduplicated: true }, { status: 503 });
    }
    return NextResponse.json(outcome.result, { status: outcome.result.merged ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
