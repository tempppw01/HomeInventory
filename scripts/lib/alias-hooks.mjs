// 单测运行时的 `@/` 别名解析钩子。
//
// 背景:`tsconfig` 用 `moduleResolution: bundler`,源码里统一写 `@/lib/xxx`;
// 但单测是直接用 node --experimental-strip-types 跑的,Node 不认识这个别名,
// 于是「引用了其他 lib 的模块」就没法直接单测 —— 这个限制之前绊过两次
// (恢复码哈希因此没进单测、这次的本地日期工具又把两个测试文件弄挂了)。
//
// 这里注册一个 resolve 钩子,把 `@/x` 映射到 `src/x`,并自动补上扩展名。
// 只影响测试进程,不改变任何构建配置。

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = path.join(projectRoot, "src", specifier.slice(2));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
