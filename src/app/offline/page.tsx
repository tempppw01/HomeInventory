import Link from "next/link";

// 离线回退页:断网时**连缓存页面都取不到**才走到这里(阶段 1 之后,能取到缓存就整页可用,
// 并配上「离线 · 这是快照」的横幅 —— 所以这一页不再是唯一的离线出口)。
//
// 这里仍然不显示任何库存数据:它只在「什么都没缓存到」时出现,那时也确实没有数据可显示。
// 「看缓存数据」指向物品页:如果那一页曾被缓存过,点击后会加载缓存的整页 + 缓存的接口快照,
// 并由横幅标明是快照;没缓存过就还会回到这一页,这是可见且可解释的结果。
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
          归物的数据都存在你自己的服务器上。这一页也没有缓存可看 —— 之前打开过的页面会带缓存,那些页面离线也能翻,
          顶上会标着「离线 · 数据是几分钟前的快照」;没打开过的页面暂时读不到。网络恢复后会自动刷新。
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/items" className="btn-primary flex min-h-11 items-center justify-center px-4 text-sm">看缓存数据</Link>
          <Link href="/" className="btn-ghost flex min-h-11 items-center justify-center px-4 text-sm">重新加载</Link>
        </div>
      </div>
    </main>
  );
}
