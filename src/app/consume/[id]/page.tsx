import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConsumeScan } from "@/components/consume-scan";

export const dynamic = "force-dynamic";

export default async function ConsumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.item.findFirst({
    where: { deletedAt: null, OR: [{ id }, { itemCode: id }] },
    select: { id: true, name: true, category: true, type: true, quantity: true, unit: true, location: { select: { name: true } } },
  });
  if (!item) notFound();
  return <ConsumeScan item={item} />;
}
