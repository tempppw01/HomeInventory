"use client";

import { Archive } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { PageTitle } from "../shared";
export function AboutView() {
  return <><PageTitle title="关于归物" text="轻量、清楚、真正适合家庭日常使用。" /><div className="max-w-3xl space-y-3"><section className="surface rounded-3xl p-6"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-3xl text-[var(--on-primary)]" style={{ background: "var(--primary)" }}><Archive size={26} /></div><div><h2 className="m-0 text-xl font-black">归物 HomeInventory</h2><p className="mb-0 mt-1 text-sm muted">版本 {APP_VERSION} · MVP 迭代起点</p></div></div><p className="mb-0 mt-5 text-sm leading-7 muted">归物帮助家庭记录物品、消耗品、保质期、采购与价格。功能设计遵循“少一步操作、少一个干扰”的原则，复杂能力放在需要时再展开。</p></section><section className="surface flex flex-wrap items-center gap-2.5 px-4 py-3"><span className="text-xs font-black">{APP_VERSION} 更新</span><span className="h-3 w-px" style={{ background: "var(--border)" }} /><span className="text-xs muted">示范数据</span><span className="text-xs muted">保质期预警</span><span className="text-xs muted">消费概览</span></section></div></>;
}

