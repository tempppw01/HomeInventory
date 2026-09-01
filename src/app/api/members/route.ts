import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser, canWrite } from "@/lib/account-auth";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await prisma.householdMember.findMany({ orderBy: { createdAt: "asc" } }));
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    if (!canWrite(user.role)) return NextResponse.json({ error: "没有执行此操作的权限" }, { status: 403 });
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "请输入成员名称" }, { status: 400 });
    const member = await prisma.$transaction(async (tx) => {
      const created = await tx.householdMember.create({ data: { name: name.slice(0, 30), color: body.color || "#7c3aed" } });
      await tx.activityLog.create({ data: { action: "MEMBER_CREATE", userId: user.id, memberId: created.id, detail: `添加家庭成员：${created.name}` } });
      return created;
    });
    return NextResponse.json(member, { status: 201 });
  } catch (error) { return apiError(error); }
}
