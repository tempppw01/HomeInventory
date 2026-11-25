// 空间层级:会不会形成环?
//
// 由来(实测,修之前):服务端只查了「父的父是不是自己」这一层 ——
// 于是「厨房 → 橱柜 → 抽屉」这种正常三级结构里,把**厨房的上级选成抽屉**会被放行,
// 变成 厨房 → 橱柜 → 抽屉 → 厨房 的环。而界面上那个「所属上级空间」下拉框
// 把除自己以外的所有空间都列出来,所以这个错误**一次编辑就能造成**,不需要调接口。
//
// 后果:沿上级链往上走永远走不到头。实测页面不会崩(lib/location-path 有 16 层护栏),
// 但空间卡片上的路径会变成「抽屉 / 橱柜 / 厨房 / 抽屉 / 橱柜 / 厨房 …」重复三遍,
// 而任何**没有**护栏的新代码(面包屑、统计、导出)都会原地打转。
//
// 所以判定收到这里:沿上级链往上走,走到自己就是环;走到一个已经在链上的节点也算环
// (说明库里本来就有脏数据);链太深也当环处理 —— 宁可拒绝一次编辑,也不要写出绕不完的结构。

export type LocationNode = { id: string; parentId: string | null };

/** 单条链的最大深度。家庭空间不会有几十层,超过就当异常。 */
const MAX_DEPTH = 64;

/**
 * 把 `id` 的上级设成 `parentId`,会不会形成环?
 *
 * @param nodes 当前库里的全部空间(至少要有 id 与 parentId)
 * @param id    正在编辑的空间
 * @param parentId 想设置的上级(null 表示设为顶级)
 */
export function wouldFormLocationCycle(nodes: readonly LocationNode[], id: string, parentId: string | null | undefined): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>([id]);
  let cursor: string | null = parentId;
  let depth = 0;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    depth += 1;
    if (depth > MAX_DEPTH) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}