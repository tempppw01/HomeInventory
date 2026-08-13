import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
export async function GET() { try { return NextResponse.json(await prisma.activityLog.findMany({ include: { member: true }, orderBy: { createdAt: "desc" }, take: 100 })); } catch (error) { return apiError(error); } }
