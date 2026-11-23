// 脚本侧的本地日格式化。
//
// 为什么复制一份,而不是 import src/lib/local-date:
// 运行镜像只复制 scripts/、prisma/、public/ 与 .next,**没有 src/ 也没有 tsconfig.json**,
// 而容器启动时 entrypoint 会跑 scripts 里的初始化脚本 —— `@/lib/...` 这种别名在镜像里解析不了,
// 脚本一抛错容器就起不来(v0.1.41 就这么让镜像冒烟测试红过两次)。
//
// 两份实现的一致性由 scripts/unit/script-local-date.test.mjs 保证:它会把两份实现跑同一批时刻对比。
export function localDateString(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
