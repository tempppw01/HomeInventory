import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { priceRecordSchema } from "@/lib/validation";

export async function GET() {
  try {
    return NextResponse.json(await prisma.priceRecord.findMany({ orderBy: { purchasedAt: "desc" }, take: 100 }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = priceRecordSchema.parse(await request.json());
    const record = await prisma.$transaction(async (tx) => {
      if (data.itemId) await tx.item.update({ where: { id: data.itemId }, data: { price: data.unitPrice, purchaseDate: data.purchasedAt || new Date() } });
      return tx.priceRecord.create({ data: { ...data, purchasedAt: data.purchasedAt || new Date(), totalPrice: data.unitPrice * data.quantity } });
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
