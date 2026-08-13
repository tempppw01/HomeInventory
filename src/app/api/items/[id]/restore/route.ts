import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const item = await prisma.item.update({ where: { id }, data: { deletedAt: null }, include: { location: true } });
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}
