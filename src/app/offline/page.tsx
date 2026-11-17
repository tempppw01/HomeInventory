import Link from "next/link";

// 离线回退页:Service Worker 在断网且无法从缓存取到页面时展示。
// 刻意只给「重新加载」与说明,不显示任何库存数据 —— 离线时看到的旧数字比看不到更危险。
export const metadata = { title: "离线 · 归物" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="surface w-full max-w-sm p-6 text-center">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-3xl" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12h20" />
            <path d="M12 2v20" opacity="0.2" />
            <path d="m4.9 4.9 14.2 14.2" />
          </svg>
        </span>
        <h1 className="m-0 text-lg font-black">现在没有网络</h1>
        <p className="mb-0 mt-2 text-sm leading-6 muted">
          归物的数据都存在你自己的服务器上,离线时无法读取。网络恢复后重新加载即可,不要按旧数据做决定。
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/" className="btn-primary flex min-h-11 items-center justify-center px-4 text-sm">重新加载</Link>
        </div>
      </div>
    </main>
  );
}