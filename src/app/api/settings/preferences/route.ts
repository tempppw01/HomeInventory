import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { householdPreferenceSchema } from "@/lib/validation";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: {} }));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireWritableUser();
    const data = householdPreferenceSchema.parse(await request.json());
    return NextResponse.json(await prisma.householdPreference.upsert({ where: { id: "default" }, create: data, update: data }));
  } catch (error) { return apiError(error); }
}
