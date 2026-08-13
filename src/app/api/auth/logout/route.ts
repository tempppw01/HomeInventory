import { NextResponse } from "next/server";
import { clearCurrentSession } from "@/lib/account-auth";

export async function POST() {
  await clearCurrentSession();
  return NextResponse.json({ ok: true });
}
