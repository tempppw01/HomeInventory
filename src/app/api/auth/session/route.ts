import { NextResponse } from "next/server";
import { currentUser } from "@/lib/account-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const setupRequired = await prisma.user.count() === 0;
  const user = setupRequired ? null : await currentUser();
  return NextResponse.json({ setupRequired, authenticated: Boolean(user), user: user && { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
}
