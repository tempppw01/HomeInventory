import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || request.headers.get("cf-connecting-ip")?.trim();
  return address ? address.slice(0, 64) : null;
}

export function summarizeDevice(userAgent: string) {
  const platform = /iPad/i.test(userAgent) ? "iPad" : /iPhone/i.test(userAgent) ? "iPhone" : /Android/i.test(userAgent) ? "Android" : /Mac OS X/i.test(userAgent) ? "macOS" : /Windows/i.test(userAgent) ? "Windows" : /Linux/i.test(userAgent) ? "Linux" : "其他设备";
  const browser = /Edg\//i.test(userAgent) ? "Edge" : /Chrome\//i.test(userAgent) ? "Chrome" : /Firefox\//i.test(userAgent) ? "Firefox" : /Safari\//i.test(userAgent) ? "Safari" : /Electron\//i.test(userAgent) ? "Electron" : "其他浏览器";
  return `${platform} · ${browser}`;
}

export async function recordLoginAttempt(request: NextRequest, data: { userId?: string; username: string; success: boolean; failureReason?: string }) {
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
  try {
    await prisma.loginRecord.create({
      data: {
        userId: data.userId,
        username: data.username,
        ipAddress: getClientIp(request),
        device: summarizeDevice(userAgent || ""),
        userAgent,
        success: data.success,
        failureReason: data.failureReason,
      },
    });
  } catch (error) {
    console.error("Failed to record login attempt", error);
  }
}
