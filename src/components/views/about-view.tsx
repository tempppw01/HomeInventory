"use client";

import { Archive, BookOpen, Boxes, Database, Info, Scale, Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { ListRow, Panel } from "../ui-kit";
import { PageTitle } from "../shared";

export function AboutView() {
  return (
    <>
      <PageTitle title="关于归物" text="轻量、清楚、真正适合家庭日常使用。" />
      <div className="max-w-3xl space-y-4 sm:space-y-5">
        <Panel padded={false} className="p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-3xl text-[var(--on-primary)]" style={{ background: "var(--primary)" }}>
              <Archive size={26} />
            </span>
            <div className="min-w-0">
              <h2 className="m-0 text-xl font-black">归物 HomeInventory</h2>
              <p className="mb-0 mt-1 text-sm muted">版本 {APP_VERSION} · MVP 迭代起点</p>
            </div>
          </div>
        </Panel>

        <Panel title="版本与更新">
          <ListRow icon={Info} title={APP_VERSION} meta="当前版本" trailing={<span className="shrink-0 text-xs font-bold muted">MVP 迭代起点</span>} />
          <ListRow icon={Sparkles} title="更新说明" meta="本版本新增:示范数据 · 保质期预警 · 消费概览" />
        </Panel>

        <Panel title="使用提示">
          <p className="mb-0 text-sm leading-7 muted">
            归物帮助家庭记录物品、消耗品、保质期、采购与价格。功能设计遵循“少一步操作、少一个干扰”的原则,复杂能力放在需要时再展开。
          </p>
          <div className="mt-3">
            <ListRow icon={Boxes} title="先录名称和数量" meta="其他信息可以之后随时补充,不用一次填完" />
            <ListRow icon={BookOpen} title="常用设置收在设置页" meta="需要时再展开,首页保持清爽" />
          </div>
        </Panel>

        <Panel title="开源与数据">
          <ListRow icon={Scale} title="自托管开源项目" meta="部署在自己的设备上,可自行改动与再发布" />
          <ListRow icon={Database} title="数据留在本机" meta="物品数据保存在你自己的服务器,不经过第三方云服务" />
        </Panel>
      </div>
    </>
  );
}
