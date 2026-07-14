import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { locationSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const data = locationSchema.parse(await request.json());
    return NextResponse.json(await prisma.location.create({ data }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
