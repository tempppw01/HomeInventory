"use client";

import { CheckCircle2, CircleAlert, LoaderCircle, Package, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ScanItem = { id: string; name: string; category: string; type: "DURABLE" | "CONSUMABLE"; quantity: number; unit: string; location: { name: string } | null };

export function ConsumeScan({ item }: { item: ScanItem }) {
  const started = useRef(false);
  const requestId = useRef<string | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("正在登记消耗…");
  const [remaining, setRemaining] = useState(item.quantity);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const scanRequestId = requestId.current ||= crypto.randomUUID();
    fetch("/api/public/consume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, requestId: scanRequestId }) })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "扫码消耗失败");
        setRemaining(Number(result.item?.quantity ?? Math.max(0, item.quantity - 1)));
        setStatus("success");
        setMessage(`已消耗 1 ${item.unit}`);
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "扫码消耗失败");
      });
  }, [item.id, item.quantity, item.unit]);

  return <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10"><article className="surface w-full rounded-[32px] p-7 text-center sm:p-9">
    <div className="mx-auto grid size-16 place-items-center rounded-3xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><ScanLine size={30} /></div>
    <p className="mb-0 mt-5 text-xs font-bold tracking-widest muted">家庭库存 · 扫码消耗</p>
    <h1 className="mb-0 mt-2 text-3xl font-black">{item.name}</h1>
    <p className="mb-0 mt-2 text-sm muted">{item.category}{item.location ? ` · ${item.location.name}` : ""}</p>
    <div className="mx-auto mt-7 flex max-w-xs items-center justify-center gap-3 rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}><Package size={20} style={{ color: "var(--primary)" }} /><span className="text-sm">扫码前 {item.quantity} {item.unit} · 扫码后 {status === "success" ? `${remaining} ${item.unit}` : "—"}</span></div>
    <div className="mt-7 flex items-center justify-center gap-2 text-sm font-bold" style={{ color: status === "success" ? "#16a34a" : status === "error" ? "#dc2626" : "var(--primary)" }}>{status === "loading" ? <LoaderCircle size={18} className="animate-spin" /> : status === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}{message}</div>
    <p className="mb-0 mt-6 text-xs leading-5 muted">此页面无需登录。请只扫描“消耗1{item.unit}”二维码；查看详情请扫描另一枚二维码。</p>
  </article></main>;
}
