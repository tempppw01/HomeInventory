import { notFound } from "next/navigation";
import Link from "next/link";
import { Archive, CalendarDays, MapPin, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.item.findFirst({
    where: { OR: [{ id }, { itemCode: id }] },
    include: { location: true },
  });
  if (!item) notFound();

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8 sm:py-14">
      <Link href="/" className="mb-8 flex items-center gap-2 text-sm font-bold" style={{ color: "var(--primary)" }}>
        <Archive size={18} /> 返回归物
      </Link>
      <article className="surface overflow-hidden rounded-[32px]">
        {item.imageUrl ? (
          <div className="h-64 bg-cover bg-center sm:h-80" style={{ backgroundImage: `url(${item.imageUrl})` }} />
        ) : (
          <div className="grid h-52 place-items-center text-6xl" style={{ background: "var(--surface-soft)" }}>📦</div>
        )}
        <div className="p-6 sm:p-8">
          <div className="mb-3 text-xs font-bold tracking-wider muted">{item.itemCode || item.id}</div>
          <h1 className="m-0 text-3xl font-black">{item.name}</h1>
          <p className="mt-2 text-sm muted">{item.category} · {item.type === "CONSUMABLE" ? "消耗品" : "耐用品"}</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <Info icon={Package} label="当前数量" value={`${item.quantity} ${item.unit}`} />
            <Info icon={MapPin} label="存放位置" value={item.location?.name || "未设置"} />
            <Info icon={CalendarDays} label="录入时间" value={item.createdAt.toLocaleDateString("zh-CN")} />
          </div>
          {item.notes && <div className="mt-6 rounded-2xl p-4 text-sm leading-6" style={{ background: "var(--surface-soft)" }}>{item.notes}</div>}
        </div>
      </article>
    </main>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return <div className="rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}><Icon size={18} className="mb-3" style={{ color: "var(--primary)" }} /><div className="text-xs muted">{label}</div><div className="mt-1 text-sm font-bold">{value}</div></div>;
}
