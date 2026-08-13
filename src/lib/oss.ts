import { prisma } from "@/lib/prisma";
import path from "node:path";
import { unlink } from "node:fs/promises";
import OSS from "ali-oss";

export type OssConfig = {
  storageMode: "local" | "oss" | "both";
  localDirectory: string;
  region: string;
  endpoint: string | null;
  bucket: string;
  directory: string;
  accessKeyId: string;
  accessKeySecret: string;
  publicBaseUrl: string | null;
};

export function ossIsManagedByEnvironment() {
  return Boolean(process.env.OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_BUCKET || process.env.IMAGE_STORAGE_MODE);
}

export async function deleteStoredImage(imageUrl: string | null | undefined) {
  if (!imageUrl) return;
  const config = await getOssConfig();
  if (!config) return;
  let localObjectName: string | null = null;
  if (imageUrl.startsWith("/api/uploads/")) {
    localObjectName = imageUrl.slice("/api/uploads/".length);
    const target = path.resolve(config.localDirectory, localObjectName);
    const root = path.resolve(config.localDirectory);
    if (target.startsWith(`${root}${path.sep}`)) await unlink(target).catch(() => undefined);
  }
  if (config.storageMode === "oss" || config.storageMode === "both") {
    const prefix = config.publicBaseUrl ? `${config.publicBaseUrl}/` : "";
    const objectName = prefix && imageUrl.startsWith(prefix) ? imageUrl.slice(prefix.length) : localObjectName;
    if (objectName) {
      const directoryPrefix = `${config.directory}/`;
      const key = objectName.startsWith(directoryPrefix) ? objectName : `${config.directory}/${objectName}`;
      if (key !== config.directory) {
        const client = new OSS({ region: config.region, endpoint: config.endpoint || undefined, bucket: config.bucket, accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret, secure: true });
        await client.delete(key).catch(() => undefined);
      }
    }
  }
}

export async function getOssConfig(): Promise<OssConfig | null> {
  const stored = await prisma.ossSetting.findUnique({ where: { id: "default" } });
  const config = {
    storageMode: (process.env.IMAGE_STORAGE_MODE || stored?.storageMode || "local") as OssConfig["storageMode"],
    localDirectory: process.env.LOCAL_UPLOAD_DIR || stored?.localDirectory || (process.env.NODE_ENV === "production" ? "/app/data/uploads" : path.join(process.cwd(), "data", "uploads")),
    region: process.env.OSS_REGION || stored?.region || "",
    endpoint: process.env.OSS_ENDPOINT || stored?.endpoint || null,
    bucket: process.env.OSS_BUCKET || stored?.bucket || "",
    directory: (process.env.OSS_DIRECTORY || stored?.directory || "home-inventory").replace(/^\/+|\/+$/g, ""),
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || stored?.accessKeyId || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || stored?.accessKeySecret || "",
    publicBaseUrl: process.env.OSS_PUBLIC_BASE_URL || stored?.publicBaseUrl || null,
  };

  const hasLocal = config.storageMode === "local" || config.storageMode === "both";
  const hasOss = config.storageMode === "oss" || config.storageMode === "both";
  if (hasLocal && config.localDirectory && (!hasOss || (config.region && config.bucket && config.accessKeyId && config.accessKeySecret))) return config;
  return hasOss && config.region && config.bucket && config.accessKeyId && config.accessKeySecret ? config : null;
}
