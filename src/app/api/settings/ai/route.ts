import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { aiIsManagedByEnvironment, getAiConfig } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { aiSettingSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getAiConfig();
    return NextResponse.json({
      configured: Boolean(config),
      managedByEnvironment: aiIsManagedByEnvironment(),
      baseUrl: config?.baseUrl ?? "https://api.openai.com/v1",
      model: config?.model ?? "gpt-4.1-mini",
      apiKeyConfigured: Boolean(config?.apiKey),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (aiIsManagedByEnvironment()) return NextResponse.json({ error: "AI 当前由环境变量管理，请在部署平台修改" }, { status: 409 });
    const input = aiSettingSchema.parse(await request.json());
    const existing = await prisma.aiSetting.findUnique({ where: { id: "default" } });
    const apiKey = input.apiKey || existing?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "首次配置必须填写 API Key" }, { status: 400 });
    await prisma.aiSetting.upsert({
      where: { id: "default" },
      create: { id: "default", baseUrl: input.baseUrl, model: input.model, apiKey },
      update: { baseUrl: input.baseUrl, model: input.model, apiKey },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
