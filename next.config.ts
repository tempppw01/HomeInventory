import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// 版本号只保留一份来源:package.json。
// 这里在构建期把它注入成常量 —— 否则界面里会另存一个手写的字符串,
// 发版后忘记同步,用户看到的版本号就是错的(此前就写死在 0.0.8)。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
