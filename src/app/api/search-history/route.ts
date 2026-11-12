import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const history = await prisma.searchHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json(history);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { query } = await request.json();
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json({ error: "搜索词不能为空" }, { status: 400 });
    }
    const trimmedQuery = query.trim();
    // 检查是否已存在相同的搜索词
    const existing = await prisma.searchHistory.findFirst({
      where: { userId: user.id, query: trimmedQuery },
    });
    if (existing) {
      // 更新时间戳
      await prisma.searchHistory.update({
        where: { id: existing.id },
        data: { createdAt: new Date() },
      });
      return NextResponse.json(existing);
    }
    // 限制最多保存 20 条记录
    const count = await prisma.searchHistory.count({ where: { userId: user.id } });
    if (count >= 20) {
      // 删除最旧的记录
      const oldest = await prisma.searchHistory.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });
      if (oldest) {
        await prisma.searchHistory.delete({ where: { id: oldest.id } });
      }
    }
    const history = await prisma.searchHistory.create({
      data: { query: trimmedQuery, userId: user.id },
    });
    return NextResponse.json(history);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      // 删除单条记录
      await prisma.searchHistory.deleteMany({
        where: { id, userId: user.id },
      });
    } else {
      // 清空所有记录
      await prisma.searchHistory.deleteMany({ where: { userId: user.id } });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
