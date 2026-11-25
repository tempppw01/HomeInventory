import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemPatchSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { deleteStoredImage } from "@/lib/oss";
import { withWriteRetry } from "@/lib/write-retry";
import { planItemUpdate, recordConsumeFromUpdate } from "@/lib/item-update";

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
      // 归一化数量 / 耐用品清到期日 / 重算洞察 / 判断该不该记消耗 —— 全部走 lib/item-update,
      // 与「批量编辑」共用同一份定义(此前两条路径各写各的,同一件事结果不一样)。
      const plan = planItemUpdate(existing, parsed);
      const data = { ...plan.data };
      const learnedRate = await recordConsumeFromUpdate(tx, { itemId: id, itemName: existing.name, userId: user.id, plan });
      if (learnedRate !== null) data.consumeRate = learnedRate;
      const updated = await tx.item.update({ where: { id }, data, include: { location: true } });
      await tx.activityLog.create({ data: { action: "UPDATE", itemId: updated.id, itemName: updated.name, userId: user.id, detail: "更新物品信息" } });
      // 结论变了就补一条 AI 分析记录:详情页据此显示「这份结论是什么时候算的」。
      if (parsed.aiSummary !== undefined || parsed.aiStorageAdvice !== undefined || parsed.aiUsageAdvice !== undefined || parsed.aiReplenishmentAdvice !== undefined) {
        await tx.activityLog.create({ data: { action: "AI_ANALYZE", itemId: updated.id, itemName: updated.name, userId: user.id, detail: "手动重新分析" } });
      }
      if (recordPurchase && updated.price != null) {
        // 用归一化之后的数量(2.5 件 → 3 件):plan.data 的类型是 Prisma 的更新输入,
        // 这里只取「确实是数字」的那一种情况,拿不到就退回库里刚写进去的值。
        const quantity = Math.max(typeof plan.data.quantity === "number" ? plan.data.quantity : updated.quantity, 1);
        await tx.priceRecord.create({ data: { itemId: updated.id, itemName: updated.name, category: updated.category, unitPrice: updated.price, quantity, totalPrice: updated.price * quantity, purchasedAt: parsed.purchaseDate || new Date(), store: purchaseStore } });
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
