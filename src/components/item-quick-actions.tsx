"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, RotateCcw } from "lucide-react";

/**
 * 物品详情页的快捷操作。
 *
 * 之前详情页是纯展示:从二维码或搜索点进来之后,想「用掉一个」或「调一下余量」必须退回物品列表,
 * 而列表里的卡片按钮在手机上又不一定在视野内 —— 这是明显的动线断点。
 * 这里直接在详情页给两个动作,写完立刻 router.refresh() 让数字与变更记录同步。
 */
export function ItemQuickActions({
  itemId,
  unit,
  type,
  remainingPercent,
  isLiquid,
}: {
  itemId: string;
  unit: string;
  type: "DURABLE" | "CONSUMABLE";
  remainingPercent: number;
  isLiquid: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || pending;

  const call = async (input: RequestInfo, init?: RequestInit) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(input, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.error || "操作失败");
      return body;
    } finally {
      setBusy(false);
    }
  };

  const consumeOne = async () => {
    try {
      await call(`/api/items/${itemId}/consume`, { method: "POST" });
      setMessage(`已用掉 1 ${unit}`);
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const adjustRemaining = async (delta: number) => {
    const next = Math.min(100, Math.max(0, Math.round(remainingPercent + delta)));
    if (next === remainingPercent) return;
    try {
      await call(`/api/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ remainingPercent: next }) });
      setMessage(`剩余量已调整为 ${next}%`);
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const canConsumeOne = type === "CONSUMABLE" && !isLiquid;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {canConsumeOne && (
          <button
            type="button"
            onClick={consumeOne}
            disabled={disabled}
            className="btn-primary inline-flex min-h-11 items-center gap-1.5 px-4 text-sm disabled:opacity-60"
            aria-label={`用掉 1 ${unit}`}
          >
            <Minus size={15} />用掉 1 {unit}
          </button>
        )}
        {isLiquid && (
          <>
            <button
              type="button"
              onClick={() => adjustRemaining(-10)}
              disabled={disabled || remainingPercent <= 0}
              className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-sm disabled:opacity-50"
              aria-label="余量减少 10%"
            >
              <Minus size={15} />少 10%
            </button>
            <button
              type="button"
              onClick={() => adjustRemaining(100 - remainingPercent)}
              disabled={disabled || remainingPercent >= 100}
              className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-sm disabled:opacity-50"
              aria-label="余量重置为 100%"
            >
              <RotateCcw size={15} />满上
            </button>
          </>
        )}
      </div>
      {message && <p className="mb-0 mt-2 text-xs font-bold" style={{ color: "var(--primary)" }}>{message}</p>}
      {error && <p className="mb-0 mt-2 text-xs font-bold" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}