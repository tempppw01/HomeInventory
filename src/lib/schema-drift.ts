// 「库结构比应用旧」这件事,要认出来并说人话。
//
// 场景很常见:自建部署把镜像换成新版本,却忘了同步数据库结构(项目用 prisma db push,
// 不是启动时自动迁移)。此时 Prisma 会抛 P2021(表不存在)/ P2022(列不存在),
// SQLite 也可能直接给出 "no such column: Item.storage" 这类消息。
//
// 实测(v0.1.38,删掉两列模拟老库):
//   · /api/items、/api/dashboard → 500「服务器暂时开小差了,请稍后重试」——
//     听起来像临时故障,用户会一直刷新重试;
//   · /api/health → 200 {"status":"ok","database":"connected"} —— 监控说一切正常。
//
// 于是这里提供统一的识别与文案:接口回 503 并带上可照做的指引,健康检查如实报 degraded。
export const SCHEMA_DRIFT_HINT =
  "数据库结构比当前版本旧(升级时可能没有同步库结构)。请先运行 npm run db:push 同步结构,再刷新页面;Docker 部署请在容器内执行同一条命令。";

/** Prisma 官方的「结构对不上」错误码 */
const SCHEMA_DRIFT_CODES = ["P2021", "P2022"];

/**
 * 是不是「库结构与应用不一致」导致的错误。
 *
 * 除了错误码,还认消息里的几种说法 —— 不同驱动/SQLite 版本措辞不一样,
 * 而这条错误一旦漏掉,用户看到的就只是「服务器开小差了」。
 */
export function isSchemaDriftError(error: unknown): boolean {
  if (!error) return false;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (SCHEMA_DRIFT_CODES.includes(code)) return true;

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return false;
  return (
    /does not exist in the current database/i.test(message) ||
    /no such (column|table)/i.test(message) ||
    /Unknown column|Unknown table|has no column named/i.test(message)
  );
}