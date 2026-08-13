import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { locationSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const data = locationSchema.parse(await request.json());
    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.location.create({ data });
      await tx.activityLog.create({ data: { action: "LOCATION_CREATE", detail: `新建位置：${created.name}` } });
      return created;
    });
    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
