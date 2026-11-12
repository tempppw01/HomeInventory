import { hashPassword, verifyPassword } from "@/lib/account-auth";
import { normalizeRecoveryCode } from "@/lib/recovery-code";

// 恢复码的入库与校验必须使用同一个规范化形式(去掉分隔符、统一大写)。
// 之前生成侧存的是「带连字符的展示形式」、校验侧用的是「紧凑形式」,
// 导致刚生成的恢复码永远校验不通过。所有写入/校验都走这两个函数,避免再分叉。
export function hashRecoveryCode(code: string): string {
  return hashPassword(normalizeRecoveryCode(code));
}

export function verifyRecoveryCode(input: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  return verifyPassword(normalizeRecoveryCode(input), stored);
}
