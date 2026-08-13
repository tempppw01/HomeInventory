import { prisma } from "@/lib/prisma";
import path from "node:path";

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
