import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// 版本号只保留一份来源:package.json。
// 这里在构建期把它注入成常量 —— 否则界面里会另存一个手写的字符串,
// 发版后忘记同步,用户看到的版本号就是错的(此前就写死在 0.0.8)。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  experimental: {
    // 恢复完整备份的请求要经过 proxy,这里默认只有 10 MB —— 超过就被拒,而且报的是
    // 「请求内容不是合法的 JSON」(误导)。导出体积会随数据增长,实测 14 MB 的备份已经过不去,
    // 所以显式抬高到与 src/lib/backup-limits.ts 一致的上限。
    // 数字与 src/lib/backup-limits.ts 的 MAX_BACKUP_BYTES 必须一致 ——
    // 这里不能 import 那个模块(next.config 解析不到),所以由单测钉住两处相等。
    proxyClientMaxBodySize: "64mb",
  },
};

export default nextConfig;
