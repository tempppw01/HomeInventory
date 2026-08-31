import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { summarizeDevice } from "@/lib/login-record";

export const ACCOUNT_COOKIE = "home_inventory_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sessionHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function createSession(userId: string, metadata?: { userAgent?: string | null; ipAddress?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: {
    tokenHash: sessionHash(token),
    userId,
    device: summarizeDevice(metadata?.userAgent || ""),
    ipAddress: metadata?.ipAddress || null,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
  } });
  return token;
}

export async function currentUser() {
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.authSession.findUnique({ where: { tokenHash: sessionHash(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  return session.user;
}

export async function userFromToken(token: string) {
  const session = await prisma.authSession.findUnique({ where: { tokenHash: sessionHash(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export function canWrite(role: "ADMIN" | "MEMBER" | "VIEWER") { return role !== "VIEWER"; }
export function canAdmin(role: "ADMIN" | "MEMBER" | "VIEWER") { return role === "ADMIN"; }

export async function clearCurrentSession() {
  const jar = await cookies();
  const token = jar.get(ACCOUNT_COOKIE)?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: sessionHash(token) } });
  jar.set(ACCOUNT_COOKIE, "", { httpOnly: true, expires: new Date(0), path: "/" });
}
