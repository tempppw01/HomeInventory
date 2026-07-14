import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "归物 · 家庭物品管理",
    short_name: "归物",
    description: "家庭物品、消耗品与采购提醒管理",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#6d4aff",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
