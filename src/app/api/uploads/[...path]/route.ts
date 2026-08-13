import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOssConfig } from "@/lib/oss";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function GET(_: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const config = await getOssConfig();
  if (!config || (config.storageMode !== "local" && config.storageMode !== "both")) return new NextResponse("Not found", { status: 404 });
  const route = await params;
  const objectName = route.path.join("/");
  const resolvedRoot = path.resolve(config.localDirectory);
  const target = path.resolve(resolvedRoot, objectName);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) return new NextResponse("Not found", { status: 404 });
  const extension = path.extname(target).slice(1).toLowerCase();
  if (!contentTypes[extension]) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await readFile(target);
    return new NextResponse(data, { headers: { "Content-Type": contentTypes[extension], "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
