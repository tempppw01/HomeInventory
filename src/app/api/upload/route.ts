import { NextRequest, NextResponse } from "next/server";
import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { apiError } from "@/lib/api";
import { getOssConfig } from "@/lib/oss";

export const runtime = "nodejs";

const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: NextRequest) {
  try {
    const config = await getOssConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中完成 OSS 配置" }, { status: 400 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择图片" }, { status: 400 });
    const extension = allowedTypes[file.type];
    if (!extension) return NextResponse.json({ error: "仅支持 JPG、PNG、WebP 或 GIF" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "图片不能超过 5MB" }, { status: 400 });

    const client = new OSS({
      region: config.region,
      endpoint: config.endpoint || undefined,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      secure: true,
    });
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    const objectName = `home-inventory/items/${date}/${randomUUID()}.${extension}`;
    const result = await client.put(objectName, Buffer.from(await file.arrayBuffer()), {
      headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
    const url = config.publicBaseUrl ? `${config.publicBaseUrl}/${objectName}` : result.url;
    return NextResponse.json({ url, objectName });
  } catch (error) {
    return apiError(error);
  }
}
