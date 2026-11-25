import { NextRequest, NextResponse } from "next/server";
import OSS from "ali-oss";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { apiError, requireWritableUser } from "@/lib/api";
import { getOssConfig } from "@/lib/oss";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, sharpFailureMessage } from "@/lib/image-limits";

export const runtime = "nodejs";


const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function safeLocalPath(root: string, objectName: string) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, objectName);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("非法图片路径");
  return target;
}

export async function POST(request: NextRequest) {
  let localObject: string | null = null;
  try {
    const user = await requireWritableUser();
    const guard = rateLimit(`upload:${user.id}`, 40, 60 * 60_000);
    if (!guard.ok) return NextResponse.json({ error: `图片上传较频繁，请 ${guard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(guard.retryAfter) } });
    const config = await getOssConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中配置图片存储方式" }, { status: 400 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择图片" }, { status: 400 });
    const extension = allowedTypes[file.type];
    if (!extension) return NextResponse.json({ error: "仅支持 JPG、PNG、WebP 或 GIF" }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "图片不能超过 5MB，请先压缩后再上传" }, { status: 400 });

    const date = new Date();
    const objectName = `items/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.jpg`;
    const source = Buffer.from(await file.arrayBuffer());
    let bytes: Buffer;
    try {
      bytes = await sharp(source, { failOn: "none", limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer();
    } catch (error) {
      // 解码失败(损坏 / 零字节 / 像素超上限)是**用户的问题**,要给能照做的中文,而不是 500。
      const message = sharpFailureMessage(error);
      if (message) return NextResponse.json({ error: message }, { status: 400 });
      throw error;
    }
    let url = "";

    if (config.storageMode === "local" || config.storageMode === "both") {
      localObject = safeLocalPath(config.localDirectory, objectName);
      await mkdir(path.dirname(localObject), { recursive: true });
      await writeFile(localObject, bytes, { flag: "wx" });
      url = `/api/uploads/${objectName}`;
    }

    if (config.storageMode === "oss" || config.storageMode === "both") {
      const client = new OSS({ region: config.region, endpoint: config.endpoint || undefined, bucket: config.bucket, accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret, secure: true });
      const ossObject = `${config.directory}/${objectName}`;
      const result = await client.put(ossObject, bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
      if (config.storageMode === "oss") url = config.publicBaseUrl ? `${config.publicBaseUrl}/${ossObject}` : result.url;
    }

    return NextResponse.json({ url, objectName, storageMode: config.storageMode });
  } catch (error) {
    if (localObject) await unlink(localObject).catch(() => undefined);
    return apiError(error);
  }
}
