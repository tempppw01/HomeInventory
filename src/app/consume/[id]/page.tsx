import { notFound } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Archive } from "lucide-react";
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
  return (
    // This route has no bottom navigation, so it opts out of the reserved
    // --bottom-nav-space (see globals.css) and offers its own way back.
    // ConsumeScan renders the <main> landmark; the wrapper stays a plain div so
    // the two landmarks never nest.
    <div
      className="flex min-h-screen flex-col gap-4 px-4 py-6"
      data-bottom-nav-space="none"
      style={{ "--bottom-nav-space": "0px" } as CSSProperties}
    >
      <Link
        href="/"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-2xl px-3 text-sm font-bold"
        style={{ background: "var(--surface-solid)", color: "var(--primary)" }}
      >
        <Archive size={18} /> 返回归物
      </Link>
      <div className="flex flex-1 items-center">
        <ConsumeScan item={item} />
      </div>
    </div>
  );
}
