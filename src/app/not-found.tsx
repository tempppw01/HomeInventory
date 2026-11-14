import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4 py-16">
      <div className="surface w-full max-w-md rounded-[var(--radius-card)] p-6 text-center sm:p-8">
        <span
          className="mx-auto grid size-12 place-items-center rounded-[var(--radius-control)] text-sm font-black"
          style={{ background: "var(--primary-soft)", color: "var(--primary-strong)" }}
        >
          404
        </span>
        <h1 className="mb-0 mt-4 text-xl font-black leading-tight tracking-[-0.01em] sm:text-2xl">没有找到这个页面</h1>
        <p className="mx-auto mb-0 mt-2 max-w-[34ch] text-sm leading-6 muted">链接可能已经失效,或者物品已经被移除。</p>
        <Link href="/" className="btn-primary mt-6 flex min-h-11 w-full items-center justify-center gap-2">
          返回归物
        </Link>
      </div>
    </main>
  );
}
