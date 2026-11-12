// Shared password helpers for the auth screen and the admin account tools.
// Keeping the rules in one place means the strength meter shown to the user
// always matches what the server actually accepts.

export const PASSWORD_MIN_LENGTH = 8;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export type PasswordStrength = {
  /** 0-4, higher is stronger. */
  score: number;
  label: string;
  tone: "danger" | "warning" | "success";
};

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "请输入密码", tone: "danger" };
  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length < PASSWORD_MIN_LENGTH) return { score: 0, label: `至少 ${PASSWORD_MIN_LENGTH} 位`, tone: "danger" };
  if (score <= 1) return { score, label: "强度偏弱", tone: "danger" };
  if (score === 2) return { score, label: "强度一般", tone: "warning" };
  if (score === 3) return { score, label: "强度不错", tone: "success" };
  return { score, label: "强度很强", tone: "success" };
}

const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

function pick(charset: string) {
  return charset[Math.floor(Math.random() * charset.length)];
}

/** Generates a readable but strong password that always satisfies the server rules. */
export function generatePassword(length = 14) {
  const size = Math.max(PASSWORD_MIN_LENGTH, Math.min(24, length));
  const required = [pick(LOWERCASE), pick(UPPERCASE), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: size - required.length }, () => pick(ALL));
  const characters = [...required, ...rest];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
}

export function usernameHint(username: string) {
  if (!username) return "3-32 位小写字母、数字或 ._-";
  if (!USERNAME_PATTERN.test(username)) return "只能使用小写字母、数字、. _ -，且以字母或数字开头";
  return "可以使用这个用户名";
}
