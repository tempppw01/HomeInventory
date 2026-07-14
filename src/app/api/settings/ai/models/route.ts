import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { modelsUrl } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { aiModelsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function providerErrorDetail(raw: string) {
  try {
    const parsed = asRecord(JSON.parse(raw));
    const error = asRecord(parsed?.error);
    const detail = error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof detail === "string") return detail.slice(0, 300);
  } catch {
    // Fall back to the raw response below.
  }
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "上游接口未提供错误详情";
}

function modelId(value: unknown) {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  return typeof record?.id === "string" ? record.id.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const input = aiModelsSchema.parse(await request.json());
    const stored = await prisma.aiSetting.findUnique({ where: { id: "default" } });
    const baseUrl = (process.env.OPENAI_BASE_URL || input.baseUrl || stored?.baseUrl || "").trim();
    const apiKey = (process.env.OPENAI_API_KEY || input.apiKey || stored?.apiKey || "").trim();

    if (!apiKey) return NextResponse.json({ error: "请先填写 API Key，再展开模型列表" }, { status: 400 });

    let response: Response;
    try {
      response = await fetch(modelsUrl(baseUrl), {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return NextResponse.json({ error: "无法连接模型列表接口，请检查接口地址、网络和证书" }, { status: 502 });
    }

    if (!response.ok) {
      const detail = providerErrorDetail(await response.text());
      const message = response.status === 401
        ? `API Key 无效或已过期，无法拉取模型列表。上游返回：${detail}`
        : response.status === 403
          ? `API Key 没有读取模型列表的权限。上游返回：${detail}`
          : `模型列表拉取失败（${response.status}）：${detail}`;
      return NextResponse.json({ error: message }, { status: response.status === 401 ? 401 : 502 });
    }

    const raw = await response.json() as unknown;
    const root = asRecord(raw);
    const entries = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : [];
    const models = [...new Set(entries.map(modelId).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (models.length === 0) return NextResponse.json({ error: "接口已连接，但没有返回可用模型" }, { status: 502 });

    return NextResponse.json({ models });
  } catch (error) {
    return apiError(error);
  }
}
