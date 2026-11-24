// 「这条记录是谁做的」——抽成纯函数,并把「账号已删除」与「公开扫码」区分开。
//
// 实测:建一个探针账号 → 用它消耗一件 → 删掉账号 → 那条记录变成
//   { userId: null, scanRequestId: null, user: null, detail: "手动消耗 1 个" }
// 而界面写的是 `${record.user?.displayName || "公开扫码"}` —— 于是**一个有账号的人做过的事被说成「公开扫码」**。
// 在这个应用里「公开扫码」指的是没登录的二维码扫码(那种记录的 scanRequestId 有值),是另一回事。
//
// 区别在于:公开扫码一定带 scanRequestId;登录用户的操作没有,但 userId 会因为账号被删而变 null。
export type ActivityActor = {
  userId?: string | null;
  scanRequestId?: string | null;
  member?: { name?: string | null } | null;
  user?: { displayName?: string | null; username?: string | null } | null;
};

/**
 * 历史记录里显示的「操作人」。
 *
 * 顺序:账号显示名 → 家庭成员的名称 → 记录自带的操作人 → 公开扫码(真·扫码)→ 账号已删除。
 */
export function activityActorLabel(record: ActivityActor | null | undefined): string {
  if (!record) return "未知";
  const display = record.user?.displayName?.trim() || record.user?.username?.trim();
  if (display) return display;
  const member = record.member?.name?.trim();
  if (member) return member;
  // 公开扫码的记录一定带 scanRequestId;没有的话,userId 为空只可能是账号被删掉了。
  if (record.scanRequestId) return "公开扫码";
  if (!record.userId) return "账号已删除";
  return "未知账号";
}