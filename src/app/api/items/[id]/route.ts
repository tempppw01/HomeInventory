import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemPatchSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { itemInsight } from "@/lib/item-insight";
import { learnConsumeRate } from "@/lib/item-forecast";
import { deleteStoredImage } from "@/lib/oss";
import { withWriteRetry } from "@/lib/write-retry";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Context) {
  try {
    await requireUser();
    const { id } = await params;
    const item = await prisma.item.findFirst({
      where: { deletedAt: null, OR: [{ id }, { itemCode: id }] },
      include: { location: true },
    });
    if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const { recordPurchase, purchaseStore, ...parsed } = itemPatchSchema.parse(await request.json());
    // 改之前的图片地址:事务提交后据此删旧文件(事务失败时不能删还在用的文件)。
    let previousImageUrl: string | null = null;
    const item = await withWriteRetry(() => prisma.$transaction(async (tx) => {
      // 记下改之前的图片地址(事务外声明,提交后再删旧文件)。
      const existing = await tx.item.findUniqueOrThrow({ where: { id } });
      // 已在回收站里的物品不允许继续改:此前这里没有判断,于是「A 把物品删进回收站、B 的老页面
      // 还能保存」会**静默成功**(200),改动存进一件用户已经扔掉的东西里;而同一个物品的消耗
      // 与详情页都会因为 deletedAt 被拒 —— 同一个状态两种行为。现在统一说清楚。
      previousImageUrl = existing.imageUrl;
      if (existing.deletedAt) {
        return { error: "这件物品已在回收站,请先从回收站恢复再修改", status: 409 as const };
      }
      const nextType = parsed.type ?? existing.type;
      const nextUnit = parsed.unit ?? existing.unit;
      const normalized = parsed.quantity === undefined ? parsed : { ...parsed, quantity: normalizeItemQuantity(parsed.quantity, nextUnit) };
      const data = nextType === "DURABLE" ? { ...normalized, expiryDate: null } : normalized;
      // 后台自动学习:液体用余量刻度记录进度、不走 consume 接口,所以在这里补一条消耗流水,
      // 再用最近 30 天的真实流水重算日均消耗 —— 用户不用手动填 consumeRate。
      const nextPercent = data.remainingPercent;
      const prevPercent = existing.remainingPercent;
      if (typeof nextPercent === "number" && nextPercent < prevPercent) {
        const equivalent = ((prevPercent - nextPercent) / 100) * Math.max(existing.quantity, 0);
        if (equivalent >= 0.1) {
          await tx.activityLog.create({ data: { action: "CONSUME", itemId: id, itemName: existing.name, userId: user.id, detail: `余量 ${Math.round(prevPercent)}% → ${Math.round(nextPercent)}%`, percentBefore: prevPercent, percentAfter: nextPercent } });
          const recentEvents = await tx.activityLog.findMany({
            where: { itemId: id, action: "CONSUME", undoneAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
            select: { createdAt: true },
          });
          // 历史每次下降幅度未知,用本次的等效量作近似,避免为了一个估值再查一堆明细。
          const learned = learnConsumeRate(recentEvents.map((row) => ({ at: row.createdAt.getTime(), units: equivalent })));
          if (learned) data.consumeRate = Number(learned.toFixed(3));
        }
      }

      // 后台自动重算:名称/分类/单位/类型任一变化都可能改变「该不该冷藏」与标签。
      const insight = itemInsight({ name: data.name ?? existing.name, category: data.category ?? existing.category, unit: (data.unit ?? existing.unit), type: (data.type ?? existing.type) as unknown as "DURABLE" | "CONSUMABLE" });
      const withInsight = { ...data, storage: insight.storage, storageReason: insight.storageReason, autoTags: insight.tags.join(",") };
      const updated = await tx.item.update({ where: { id }, data: withInsight, include: { location: true } });
      await tx.activityLog.create({ data: { action: "UPDATE", itemId: updated.id, itemName: updated.name, userId: user.id, detail: "更新物品信息" } });
      // 结论变了就补一条 AI 分析记录:详情页据此显示「这份结论是什么时候算的」。
      if (parsed.aiSummary !== undefined || parsed.aiStorageAdvice !== undefined || parsed.aiUsageAdvice !== undefined || parsed.aiReplenishmentAdvice !== undefined) {
        await tx.activityLog.create({ data: { action: "AI_ANALYZE", itemId: updated.id, itemName: updated.name, userId: user.id, detail: "手动重新分析" } });
      }
      if (recordPurchase && updated.price != null) {
        const quantity = Math.max(data.quantity ?? updated.quantity, 1);
        await tx.priceRecord.create({ data: { itemId: updated.id, itemName: updated.name, category: updated.category, unitPrice: updated.price, quantity, totalPrice: updated.price * quantity, purchasedAt: data.purchaseDate || new Date(), store: purchaseStore } });
      }
      return updated;
    }));

    // 事务里可能提前返回「已在回收站」这类错误,必须在继续之前处理掉 ——
    // 否则后面会拿着一个错误对象当物品用。
    if ("error" in item) return NextResponse.json({ error: item.error }, { status: item.status });

    // 换了图片就把旧文件删掉:此前只在**永久删除物品**时清理,于是「换一张图」会一直留孤儿 ——
    // 实测:同一个物品连换三次图,三张全留在磁盘上(磁盘只涨不降;自托管 NAS 会一直积)。
    // 放在事务提交之后:事务失败时不能把还在用的文件删了。
    if (previousImageUrl && previousImageUrl !== item.imageUrl) {
      await deleteStoredImage(previousImageUrl);
    }
    // 放进事务里:此前是「先查后建」,并发请求会各建一条重复的采购建议(实测 6 并发 → 6 条),
    // 而且历史遗留的重复项会在下次触发时被顺手清掉(见 ensureRestockSuggestion)。
    await prisma.$transaction((tx) => ensureRestockSuggestion(tx, item));
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.permanent === true) {
      await prisma.activityLog.create({ data: { action: "DELETE_PERMANENT", itemName: item.name, userId: user.id, detail: "永久删除物品（历史关联已保留为名称快照）" } });
      await prisma.item.delete({ where: { id } });
      await deleteStoredImage(item.imageUrl);
    }
    else {
      await prisma.item.update({ where: { id }, data: { deletedAt: new Date() } });
      await prisma.activityLog.create({ data: { action: "DELETE", itemId: item.id, itemName: item.name, userId: user.id, memberId: (await prisma.householdMember.findFirst({ where: { userId: user.id }, select: { id: true } }))?.id ?? null, detail: "移入回收站" } });
    }
    return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() });
  } catch (error) {
    return apiError(error);
  }
}
