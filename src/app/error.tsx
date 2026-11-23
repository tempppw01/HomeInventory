"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string; fromServer?: boolean; code?: string; status?: number }; reset: () => void }) {
  // 服务端明确说了原因就照实说(例如「库结构比当前版本旧,请先运行 npm run db:push」)。
  // 这类问题重试一百次也没用,把它换成「可以重试一次」等于让用户白折腾。
  const serverMessage = error?.fromServer && typeof error.message === "string" && error.message.trim()
    ? error.message.trim().slice(0, 240)
    : null;
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4 py-16">
      <div className="surface w-full max-w-md rounded-[var(--radius-card)] p-6 text-center sm:p-8">
        <span
          className="mx-auto grid size-12 place-items-center rounded-[var(--radius-control)] text-lg font-black"
          style={{
            background: "color-mix(in srgb, var(--danger) 10%, var(--surface-solid))",
            border: "1px solid color-mix(in srgb, var(--danger) 26%, transparent)",
            color: "var(--danger)",
          }}
        >
          !
        </span>
        <h1 className="mb-0 mt-4 text-xl font-black leading-tight tracking-[-0.01em] sm:text-2xl">页面没能加载出来</h1>
        {serverMessage ? (
          <p className="mx-auto mb-0 mt-2 max-w-[46ch] text-sm leading-6" data-error-source="server">{serverMessage}</p>
        ) : (
          <p className="mx-auto mb-0 mt-2 max-w-[34ch] text-sm leading-6 muted">数据没有被改动。可以重试一次,或者返回首页。</p>
        )}
{serverMessage && <p className="mx-auto mb-0 mt-2 max-w-[34ch] text-xs leading-5 muted">数据没有被改动。处理完上面的问题后重试,或返回首页。</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={reset} className="btn-primary flex min-h-11 flex-1 items-center justify-center gap-2">
            <RotateCcw size={16} /> 重试
          </button>
          <Link href="/" className="btn-ghost flex min-h-11 flex-1 items-center justify-center">
            返回归物
          </Link>
        </div>
      </div>
    </main>
  );
}
