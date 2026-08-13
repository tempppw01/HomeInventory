import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth-token";

export async function GET(request: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.json({ enabled: false, authenticated: true });
  const expected = await authToken(password);
  return NextResponse.json({ enabled: true, authenticated: request.cookies.get(AUTH_COOKIE)?.value === expected });
}
