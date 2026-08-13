import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shoppingSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const data = shoppingSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.shoppingItem.create({ data });
      await tx.activityLog.create({ data: { action: "SHOPPING_CREATE", itemName: created.name, detail: "添加采购项" } });
      return created;
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
