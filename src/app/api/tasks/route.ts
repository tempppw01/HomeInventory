import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";

function nextDate(date: Date, recurrence: string) {
  const next = new Date(date);
  if (recurrence === "DAILY") next.setDate(next.getDate() + 1);
  else if (recurrence === "WEEKLY") next.setDate(next.getDate() + 7);
  else if (recurrence === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else if (recurrence === "YEARLY") next.setFullYear(next.getFullYear() + 1);
  return next;
}

export async function GET() {
  try {
    await requireUser();
    const tasks = await prisma.householdTask.findMany({ orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }] });
    return NextResponse.json({ tasks });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await requireWritableUser();
    const body = await request.json();
    const title = String(body.title || "").trim();
    if (!title) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
    const recurrence = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(body.recurrence) ? body.recurrence : "NONE";
    const dueAt = new Date(body.dueAt);
    if (!Number.isFinite(dueAt.getTime())) return NextResponse.json({ error: "请选择有效日期" }, { status: 400 });
    const task = await prisma.householdTask.create({ data: { title, description: body.description ? String(body.description).trim() : null, dueAt, recurrence } });
    return NextResponse.json(task, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireWritableUser();
    const body = await request.json();
    const id = String(body.id || "");
    const existing = await prisma.householdTask.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    if (body.action === "delete") { await prisma.householdTask.delete({ where: { id } }); return NextResponse.json({ ok: true }); }
    if (body.action === "toggle") {
      if (existing.status === "OPEN") {
        if (existing.recurrence !== "NONE") {
          const nextDueAt = nextDate(existing.dueAt, existing.recurrence);
          const task = await prisma.householdTask.update({ where: { id }, data: { dueAt: nextDueAt, nextDueAt, completedAt: new Date() } });
          return NextResponse.json(task);
        }
        return NextResponse.json(await prisma.householdTask.update({ where: { id }, data: { status: "DONE", completedAt: new Date() } }));
      }
      return NextResponse.json(await prisma.householdTask.update({ where: { id }, data: { status: "OPEN", completedAt: null } }));
    }
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) { return apiError(error); }
}
