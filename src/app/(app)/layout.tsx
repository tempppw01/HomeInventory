"use client";

import { MotionConfig } from "motion/react";

import { AuthGate } from "@/components/auth-gate";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { AppProvider } from "@/components/app/app-provider";
import { AppChrome } from "@/components/app/app-chrome";

/**
 * 应用路由组:所有登录后的一级页面(概览 / 物品 / 空间 / 任务 / 盘点 / 设置 / 关于)
 * 共用同一个外壳。layout 在兄弟路由之间切换时不会卸载,所以 provider 里的
 * 数据、搜索词、筛选、主题、侧栏折叠状态都会跨页面保留 —— 这正是原来单页
 * 应用的行为。
 *
 * 顺序与原 InventoryApp 保持一致:AuthGate(未登录时不发起任何数据请求)
 * → MotionConfig(reducedMotion="user") → ConfirmProvider → AppProvider → AppChrome。
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <MotionConfig reducedMotion="user">
        <ConfirmProvider>
          <AppProvider>
            <AppChrome>{children}</AppChrome>
          </AppProvider>
        </ConfirmProvider>
      </MotionConfig>
    </AuthGate>
  );
}
