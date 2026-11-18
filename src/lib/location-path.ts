// 空间路径 —— 让「厨房 / 吊柜」这种层级在导出/导入时能保住。
//
// 之前导出的 CSV 只写空间名(「吊柜」),层级信息丢了;导入时也只当扁平名字处理,
// 于是「厨房/吊柜」和「阳台/吊柜」会被混成同一个空间。

export type LocationLike = { id: string; name: string; parentId: string | null };

/** 把一段路径拆成各级名称:容忍斜杠两侧的空格与全角斜杠。 */
export function parseLocationPath(value: string): string[] {
  return value
    .split(/[/／]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 拼成 CSV 里用的路径(用 / 连接,不带空格,便于再次解析)。 */
export function formatLocationPath(segments: readonly string[]): string {
  return segments.filter(Boolean).join("/");
}

/** 从扁平列表算出 id → 完整路径分段(供导出使用)。 */
export function locationSegmentsById(locations: readonly LocationLike[]): Map<string, string[]> {
  const byId = new Map(locations.map((row) => [row.id, row]));
  const result = new Map<string, string[]>();
  for (const location of locations) {
    const segments: string[] = [location.name];
    let parentId = location.parentId;
    let guard = 0;
    while (parentId && guard < 16) {
      const parent = byId.get(parentId);
      if (!parent) break;
      segments.unshift(parent.name);
      parentId = parent.parentId;
      guard += 1;
    }
    result.set(location.id, segments);
  }
  return result;
}

export type PathResolution = {
  /** 已有的空间:路径 → id */
  pathToId: Map<string, string>;
  /** 需要新建的:按顺序(父在前) */
  creations: Array<{ name: string; parentPath: string; path: string }>;
  /** 无法解析的路径 → 原因 */
  issues: Array<{ path: string; error: string }>;
};

/**
 * 规划「按路径找空间」:已有的直接给 id,缺的排成创建计划(父级优先)。
 * 纯函数,不碰数据库,便于单测;接口按 creations 顺序建即可。
 */
export function resolveLocationPaths(locations: readonly LocationLike[], paths: readonly string[]): PathResolution {
  const pathToId = new Map<string, string>();
  const childrenByParent = new Map<string, Map<string, string>>(); // parentPath → name → id

  for (const [id, segments] of locationSegmentsById(locations)) {
    const path = formatLocationPath(segments);
    pathToId.set(path, id);
    const parentPath = formatLocationPath(segments.slice(0, -1));
    const bucket = childrenByParent.get(parentPath) ?? new Map<string, string>();
    bucket.set(segments[segments.length - 1], id);
    childrenByParent.set(parentPath, bucket);
  }

  const creations: PathResolution["creations"] = [];
  const issues: PathResolution["issues"] = [];
  const planned = new Set<string>();

  for (const raw of paths) {
    const segments = parseLocationPath(raw);
    if (!segments.length) { issues.push({ path: raw, error: "位置为空" }); continue; }
    if (segments.length > 8) { issues.push({ path: raw, error: "层级太深(最多 8 级)" }); continue; }

    let parentPath = "";
    for (const name of segments) {
      const path = formatLocationPath([...parseLocationPath(parentPath), name]);
      if (pathToId.has(path)) { parentPath = path; continue; }
      if (!planned.has(path)) {
        planned.add(path);
        creations.push({ name, parentPath, path });
      }
      parentPath = path;
    }
  }

  return { pathToId, creations, issues };
}