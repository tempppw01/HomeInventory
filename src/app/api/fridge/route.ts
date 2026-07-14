import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { fridgeReadingSchema, fridgeSettingSchema } from "@/lib/validation";

export async function GET() {
  try {
    const [setting, readings] = await Promise.all([
      prisma.fridgeSetting.findUnique({ where: { id: "default" } }),
      prisma.fridgeReading.findMany({ orderBy: { recordedAt: "desc" }, take: 12 }),
    ]);
    return NextResponse.json({ setting: setting ?? { id: "default", enabled: true, targetMin: 2, targetMax: 8 }, readings });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = fridgeReadingSchema.parse(await request.json());
    return NextResponse.json(await prisma.fridgeReading.create({ data }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const data = fridgeSettingSchema.parse(await request.json());
    return NextResponse.json(await prisma.fridgeSetting.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data }));
  } catch (error) {
    return apiError(error);
  }
}
