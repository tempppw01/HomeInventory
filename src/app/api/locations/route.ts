import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { locationSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const data = locationSchema.parse(await request.json());
    if (data.parentId && data.parentId === request.nextUrl.searchParams.get("id")) return NextResponse.json({ error: "空间不能设为自己的上级" }, { status: 400 });
    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.location.create({ data });
      await tx.activityLog.create({ data: { action: "LOCATION_CREATE", userId: user.id, detail: `新建位置：${created.name}` } });
      return created;
    });
    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
