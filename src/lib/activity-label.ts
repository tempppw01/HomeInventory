// 操作日志的动作名 → 用户能看懂的中文。枚举名不该出现在界面上。
export const ACTIVITY_LABELS: Record<string, string> = {
  CREATE: "录入物品",
  UPDATE: "更新物品",
  DELETE: "移入回收站",
  DELETE_PERMANENT: "永久删除",
  RESTORE: "从回收站恢复",
  CONSUME: "消耗",
  CONSUME_UNDO: "撤销消耗",
  LOCATION_CREATE: "新建空间",
  LOCATION_UPDATE: "更新空间",
  LOCATION_DELETE: "删除空间",
  SHOPPING_CREATE: "添加采购项",
  SHOPPING_MERGE: "合并采购项",
  SHOPPING_DELETE: "删除采购项",
  MEMBER_CREATE: "添加家庭成员",
  MEMBER_DELETE: "移除家庭成员",
  TASK_CREATE: "安排任务",
  TASK_DONE: "完成任务",
  TASK_DELETE: "删除任务",
  BACKUP_AUTO: "自动备份",
  BACKUP_RESTORE: "恢复备份",
  IMPORT: "导入物品",
  PRICE_CREATE: "记录价格",
  PASSWORD_RESET: "重置密码",
  RECOVERY_CODE_CREATE: "生成恢复码",
  ACCOUNT_SETUP: "初始化账号",
};

export function activityLabel(action: string) {
  return ACTIVITY_LABELS[action] ?? action;
}

