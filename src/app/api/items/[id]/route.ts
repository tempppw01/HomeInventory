import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemPatchSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const data = itemPatchSchema.parse(await request.json());
    const item = await prisma.item.update({ where: { id }, data, include: { location: true } });

    if (item.type === "CONSUMABLE" && item.minQuantity > 0 && item.quantity <= item.minQuantity) {
      const existing = await prisma.shoppingItem.findFirst({ where: { name: item.name, status: "PENDING" } });
      if (!existing) {
        await prisma.shoppingItem.create({
          data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" },
        });
      }
    }
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    await prisma.item.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
