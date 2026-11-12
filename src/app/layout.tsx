import type { Metadata, Viewport } from "next";
import { TopProgressBar } from "@/components/top-progress";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "归物 · 家庭物品管理", template: "%s · 归物" },
  description: "轻松管理家庭物品、消耗品库存与采购提醒。",
  applicationName: "归物",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "归物" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately no zoom lock here: pinching to zoom must stay available
  // (WCAG 1.4.4). Inputs already use >=16px text, so focus zoom is not an issue.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#111722" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <TopProgressBar />
        {children}
      </body>
    </html>
  );
}
