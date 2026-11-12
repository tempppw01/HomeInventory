import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-16">
      <div className="surface w-full max-w-md rounded-3xl p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl text-sm font-black" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
          404
        </span>
        <h1 className="mb-0 mt-4 text-xl font-black">没有找到这个页面</h1>
        <p className="mb-0 mt-2 text-sm leading-6 muted">链接可能已经失效,或者物品已经被移除。</p>
        <Link href="/" className="btn-primary mt-6 flex w-full items-center justify-center gap-2">
          返回归物
        </Link>
      </div>
    </main>
  );
}
