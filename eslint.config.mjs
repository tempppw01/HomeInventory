import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // output/ 是探针脚本产物(截图、导出的 bundle、一次性小工具),已经在 .gitignore 里,
  // 但它落在工作区里,`eslint .` 会把它当源码扫 —— 本地跑 npm run lint 会冒出几千条
  // 来自生成文件的报错,真正的源码问题反而被淹掉。
  globalIgnores([".next/**", "output/**", "next-env.d.ts"]),
]);
