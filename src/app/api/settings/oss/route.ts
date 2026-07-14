import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getOssConfig, ossIsManagedByEnvironment } from "@/lib/oss";
import { ossSettingSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getOssConfig();
    return NextResponse.json({
      configured: Boolean(config),
      managedByEnvironment: ossIsManagedByEnvironment(),
      region: config?.region ?? "",
      endpoint: config?.endpoint ?? "",
      bucket: config?.bucket ?? "",
      accessKeyId: config?.accessKeyId ?? "",
      accessKeySecretConfigured: Boolean(config?.accessKeySecret),
      publicBaseUrl: config?.publicBaseUrl ?? "",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (ossIsManagedByEnvironment()) {
      return NextResponse.json({ error: "OSS 当前由环境变量管理，请在部署平台修改" }, { status: 409 });
    }
    const input = ossSettingSchema.parse(await request.json());
    const existing = await prisma.ossSetting.findUnique({ where: { id: "default" } });
    const secret = input.accessKeySecret || existing?.accessKeySecret;
    if (!secret) return NextResponse.json({ error: "首次配置必须填写 AccessKey Secret" }, { status: 400 });

    await prisma.ossSetting.upsert({
      where: { id: "default" },
      create: { id: "default", ...input, accessKeySecret: secret },
      update: { ...input, accessKeySecret: secret },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
