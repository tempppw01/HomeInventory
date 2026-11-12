// 一次性恢复码:用于「忘记密码」时自助重置。
//
// 设计要点:
// - 16 个字符,取自去掉易混淆字符(I/O/0/1)的 32 字符表,约 80 位熵;
// - 展示时按 4 位分组(XXXX-XXXX-XXXX-XXXX),输入时忽略大小写与分隔符;
// - 服务端只保存 scrypt 哈希(与登录密码同一套哈希),明文只在生成当次返回一次;
// - 重置成功后立即轮换,旧码作废(一次性)。
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_LENGTH = 16;
export const RECOVERY_CODE_GROUPS = 4;

export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return formatRecoveryCode(code);
}

/** 去掉分隔符与空白、统一大写,便于比较用户输入。 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 把紧凑形式格式化成 XXXX-XXXX-XXXX-XXXX,已是分组形式则原样返回。 */
export function formatRecoveryCode(code: string): string {
  const compact = normalizeRecoveryCode(code);
  if (compact.length !== RECOVERY_CODE_LENGTH) return code;
  const size = RECOVERY_CODE_LENGTH / RECOVERY_CODE_GROUPS;
  return Array.from({ length: RECOVERY_CODE_GROUPS }, (_, index) => compact.slice(index * size, (index + 1) * size)).join("-");
}

/** 结构是否合法(不校验是否属于某个账号)。 */
export function isRecoveryCodeShape(input: string): boolean {
  const compact = normalizeRecoveryCode(input);
  if (compact.length !== RECOVERY_CODE_LENGTH) return false;
  return [...compact].every((character) => ALPHABET.includes(character));
}
