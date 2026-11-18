import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { taskCreateSchema, taskPatchSchema } from "@/lib/validation";
import { isTaskRecurrence, nextDueDate } from "@/lib/task-recurrence";



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
    const body = taskCreateSchema.parse(await request.json());
    const title = body.title;
    const recurrence = isTaskRecurrence(body.recurrence) ? body.recurrence : "NONE";
    const dueAt = new Date(body.dueAt);
    if (!Number.isFinite(dueAt.getTime())) return NextResponse.json({ error: "请选择有效日期" }, { status: 400 });
    const task = await prisma.householdTask.create({ data: { title, description: body.description ? String(body.description).trim() : null, dueAt, recurrence } });
    return NextResponse.json(task, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireWritableUser();
    const body = taskPatchSchema.parse(await request.json());
    const id = body.id;
    const existing = await prisma.householdTask.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    if (body.action === "delete") { await prisma.householdTask.delete({ where: { id } }); return NextResponse.json({ ok: true }); }
    if (body.action === "toggle") {
      if (existing.status === "OPEN") {
        if (existing.recurrence !== "NONE") {
          const nextDueAt = nextDueDate(existing.dueAt, existing.recurrence);
          const task = await prisma.householdTask.update({ where: { id }, data: { dueAt: nextDueAt, nextDueAt, completedAt: new Date() } });
          return NextResponse.json(task);
        }
        return NextResponse.json(await prisma.householdTask.update({ where: { id }, data: { status: "DONE", completedAt: new Date() } }));
      }
      return NextResponse.json(await prisma.householdTask.update({ where: { id }, data: { status: "OPEN", completedAt: null } }));
    }
    if (body.action === "undo") {
      const previousDueAt = new Date(body.previousDueAt ?? "");
      if (!Number.isFinite(previousDueAt.getTime())) return NextResponse.json({ error: "撤销信息已失效" }, { status: 400 });
      return NextResponse.json(await prisma.householdTask.update({ where: { id }, data: { status: "OPEN", dueAt: previousDueAt, nextDueAt: null, completedAt: null } }));
    }
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) { return apiError(error); }
}
