import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shoppingSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const data = shoppingSchema.parse(await request.json());
    return NextResponse.json(await prisma.shoppingItem.create({ data }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
