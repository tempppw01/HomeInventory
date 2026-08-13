import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAdmin, hashPassword, requireUser } from "@/lib/account-auth";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const actor = await requireUser();
    if (!canAdmin(actor.role)) return NextResponse.json({ error: "只有管理员可以管理账号" }, { status: 403 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    const data: { active?: boolean; role?: "ADMIN" | "MEMBER" | "VIEWER"; passwordHash?: string } = {};
    if (typeof body.active === "boolean") data.active = body.active;
    if (body.role === "ADMIN" || body.role === "MEMBER" || body.role === "VIEWER") data.role = body.role;
    if (typeof body.password === "string" && body.password.length >= 8) data.passwordHash = hashPassword(body.password);
    if (!Object.keys(data).length) return NextResponse.json({ error: "没有可更新的内容" }, { status: 400 });
    if (target.role === "ADMIN" && (data.role === "MEMBER" || data.role === "VIEWER" || data.active === false)) {
      const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
      if (admins <= 1) return NextResponse.json({ error: "至少保留一个启用的管理员" }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data, select: { id: true, username: true, displayName: true, role: true, active: true } });
      await tx.activityLog.create({ data: { action: "ACCOUNT_UPDATE", userId: actor.id, detail: `更新账号：${target.username}` } });
      if (data.active === false) await tx.authSession.deleteMany({ where: { userId: id } });
      return user;
    });
    return NextResponse.json(updated);
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHORIZED" ? "请先登录" : "更新账号失败" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500 }); }
}

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const actor = await requireUser();
    if (!canAdmin(actor.role)) return NextResponse.json({ error: "只有管理员可以管理账号" }, { status: 403 });
    const { id } = await params;
    if (id === actor.id) return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 });
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    if (target.role === "ADMIN" && await prisma.user.count({ where: { role: "ADMIN", active: true } }) <= 1) return NextResponse.json({ error: "至少保留一个启用的管理员" }, { status: 409 });
    await prisma.$transaction(async (tx) => { await tx.user.delete({ where: { id } }); await tx.activityLog.create({ data: { action: "ACCOUNT_DELETE", userId: actor.id, detail: `删除账号：${target.username}` } }); });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHORIZED" ? "请先登录" : "删除账号失败" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500 }); }
}
