// 一条 route 里把「编码 + 包成 NextResponse」收在一起,免得每个调用点抄三行。
// 逻辑本身在 src/lib/json-compression.ts(零依赖、可单测),这里只负责桥到 Next。
import { NextResponse } from "next/server";
import { encodeJsonResponse } from "@/lib/json-compression";

export function compressedJson(data: unknown, request: Request, init?: { status?: number; headers?: Record<string, string> }) {
  const encoded = encodeJsonResponse(data, request.headers.get("accept-encoding"), init);
  return new NextResponse(encoded.body, { status: encoded.status, headers: encoded.headers });
}
