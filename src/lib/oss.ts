import { prisma } from "@/lib/prisma";

export type OssConfig = {
  region: string;
  endpoint: string | null;
  bucket: string;
  directory: string;
  accessKeyId: string;
  accessKeySecret: string;
  publicBaseUrl: string | null;
};

export function ossIsManagedByEnvironment() {
  return Boolean(process.env.OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_BUCKET);
}

export async function getOssConfig(): Promise<OssConfig | null> {
  const stored = await prisma.ossSetting.findUnique({ where: { id: "default" } });
  const config = {
    region: process.env.OSS_REGION || stored?.region || "",
    endpoint: process.env.OSS_ENDPOINT || stored?.endpoint || null,
    bucket: process.env.OSS_BUCKET || stored?.bucket || "",
    directory: (process.env.OSS_DIRECTORY || stored?.directory || "home-inventory").replace(/^\/+|\/+$/g, ""),
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || stored?.accessKeyId || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || stored?.accessKeySecret || "",
    publicBaseUrl: process.env.OSS_PUBLIC_BASE_URL || stored?.publicBaseUrl || null,
  };

  return config.region && config.bucket && config.accessKeyId && config.accessKeySecret ? config : null;
}
