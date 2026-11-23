"use client";

// 物品详情页的「问 AI 关于这件」入口。
//
// 关键约束:items/[id] 不在 (app) 路由组里,页面里既没有 AppProvider 也没有助手外壳
// (早期用 useApp() 会直接 500,派发事件也没人接)。所以这里只做一件事:
// 把问题带在 URL 上跳回概览,由外壳读取 ?ask= 打开助手并预填。

import { MessageCircleQuestion } from "lucide-react";

export function AskAiAboutItem({ itemName }: { itemName: string }) {
  const question = `「${itemName}」该怎么保存?大概多久用完或过期?`;
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = `/?ask=${encodeURIComponent(question)}`;
      }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors md:min-h-10"
      style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
      aria-label={`问 AI 关于这件「${itemName}」的问题`}
    >
      <MessageCircleQuestion size={14} />
      问 AI 关于这件
    </button>
  );
}
