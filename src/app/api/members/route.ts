import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function GET() { try { return NextResponse.json(await prisma.householdMember.findMany({ orderBy: { createdAt: "asc" } })); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) { try { const body = await request.json(); if (!String(body.name || "").trim()) return NextResponse.json({ error: "请输入成员名称" }, { status: 400 }); const member = await prisma.$transaction(async (tx) => { const created = await tx.householdMember.create({ data: { name: String(body.name).trim().slice(0, 30), color: body.color || "#7c3aed" } }); await tx.activityLog.create({ data: { action: "MEMBER_CREATE", detail: `添加家庭成员：${created.name}`, member: { connect: { id: created.id } } } }); return created; }); return NextResponse.json(member, { status: 201 }); } catch (error) { return apiError(error); } }
