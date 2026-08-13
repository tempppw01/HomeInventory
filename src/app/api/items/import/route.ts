import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.items;
    if (!Array.isArray(rows)) return NextResponse.json({ error: "导入文件格式不正确" }, { status: 400 });
    let count = 0;
    for (const row of rows.slice(0, 1000)) {
      if (!row?.name || !row?.category) continue;
      await prisma.item.create({ data: { itemCode: createItemCode(), name: String(row.name).slice(0, 80), category: String(row.category).slice(0, 40), type: row.type === "CONSUMABLE" ? "CONSUMABLE" : "DURABLE", quantity: Number(row.quantity) || 1, unit: String(row.unit || "件").slice(0, 12), price: row.price == null ? null : Number(row.price), notes: row.notes ? String(row.notes).slice(0, 500) : null, deletedAt: null } });
      count += 1;
    }
    return NextResponse.json({ count }, { status: 201 });
  } catch (error) { return apiError(error); }
}
