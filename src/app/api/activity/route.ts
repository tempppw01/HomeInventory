import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const scanOnly = request.nextUrl.searchParams.get("scan") === "1";
    return NextResponse.json(await prisma.activityLog.findMany({
      where: scanOnly ? { action: { in: ["CONSUME", "CONSUME_UNDO"] } } : undefined,
      include: { member: true, user: { select: { displayName: true, username: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }));
  } catch (error) {
    return apiError(error);
  }
}
