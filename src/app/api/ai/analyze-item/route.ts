import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { anthropicMessagesUrl, chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { aiAnalyzeSchema } from "@/lib/validation";
import { localUploadDataUrl } from "@/lib/oss";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

class AiRequestError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function extractJson(content: string): JsonRecord {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>\s*/i, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  try {
    const parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
    const record = asRecord(parsed);
    if (!record) throw new Error("not an object");
    return record;
  } catch {
    throw new AiRequestError("AI 返回的内容不是有效 JSON，请确认模型支持 Chat Completions，或换一个兼容模型重试");
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join("\n");
  const record = asRecord(content);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (record.content !== undefined) return contentText(record.content);
  return "";
}

function extractAnalysis(result: unknown) {
  const root = asRecord(result);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const parsed = asRecord(message?.parsed);
  if (parsed) return parsed;
  const directContent = asRecord(message?.content);
  if (directContent) return directContent;
  const text = contentText(message?.content) || contentText(choice?.text) || contentText(root?.content) || contentText(root?.output_text) || contentText(root?.output);
  if (!text) throw new AiRequestError("AI 接口未返回可解析内容，请确认该渠道支持 Chat Completions 格式");
  return extractJson(text);
}

function providerErrorDetail(raw: string) {
  try {
    const parsed = asRecord(JSON.parse(raw));
    const error = asRecord(parsed?.error);
    const detail = error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof detail === "string") return detail.slice(0, 400);
  } catch {
    // Fall back to the raw provider response below.
  }
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) || "上游接口未提供错误详情";
}

function providerFailure(status: number, raw: string) {
  const detail = providerErrorDetail(raw);
  if (status === 401) return `API Key 无效或已过期，请在设置中重新填写后再试。上游返回：${detail}`;
  if (status === 403) return `API Key 没有访问当前模型的权限。上游返回：${detail}`;
  return `AI 接口请求失败（${status}）：${detail}`;
}

function connectionError(error: unknown, baseUrl: string) {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "AI 接口连接超时，请检查接口地址、网络和渠道状态";
  let localAddress = false;
  try {
    localAddress = ["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname);
  } catch {
    // The settings validator already rejects malformed URLs.
  }
  const cause = asRecord(asRecord(error)?.cause);
  const code = typeof cause?.code === "string" ? `（${cause.code}）` : "";
  if (localAddress) return `无法连接 AI 接口${code}。如果应用运行在 Docker 中，localhost 指向容器自身，请改用 host.docker.internal 或容器可访问的地址`;
  return `无法连接 AI 接口${code}，请检查接口地址、证书、网络和渠道状态`;
}

export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const input = aiAnalyzeSchema.parse(await request.json());
    const config = await getAiConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中配置 OpenAI 兼容接口" }, { status: 400 });

    const isMedicine = input.item?.category === "医药";
    const task = isMedicine
      ? input.action === "identify"
        ? "核对药品名称、剂型与基本说明书信息"
        : input.action === "shelf_life"
          ? "分析药品有效期与保存风险"
          : "补全药品说明书要点、适应症、常见用量与安全提醒"
      : input.action === "identify"
        ? "识别或纠正物品基本信息"
        : input.action === "shelf_life"
          ? "分析保质期和到期风险"
          : "完成全面的家庭库存分析";
    const medicineRules = isMedicine
      ? "这是医药物品：summary 请简短说明药品用途；storageAdvice 请写说明书或保存要点；usageAdvice 请写适应症与常见成人用法用量（仅在包装或说明书信息明确时填写）；replenishmentAdvice 请写禁忌、特殊人群、就医或药师提醒。不得根据图片或名称猜测处方剂量、儿童剂量、相互作用或诊断；任何无法确认的信息都必须明确写“请以包装说明书或药师指导为准”。"
      : "";
    const text = `当前日期：${new Date().toISOString().slice(0, 10)}\n任务：${task}\n现有物品信息：${JSON.stringify(input.item || {})}\n用户补充：${input.hint || "无"}\n${medicineRules}\n请返回严格 JSON，不要 Markdown。字段：name, category, type(DURABLE或CONSUMABLE), unit, suggestedExpiryDate(YYYY-MM-DD或null), shelfLifeDays(数字或null), expiryReason, storageAdvice, usageAdvice, replenishmentAdvice, suggestedNotes, confidence(0到1), summary。耐用品不设置保质期，如果 type 为 DURABLE，suggestedExpiryDate 和 shelfLifeDays 必须返回 null。不能确认时保留现有值或返回 null，不要虚构精确保质期。`;
    const imageUrl = (await localUploadDataUrl(input.imageUrl)) || input.imageUrl;
    const userContent = imageUrl
      ? [{ type: "text", text }, { type: "image_url", image_url: { url: imageUrl, detail: "low" } }]
      : text;
    const system = isMedicine
      ? "你是谨慎的家庭药箱信息整理助手。你只整理包装和说明书中可确认的信息，不提供诊断、处方、个体化剂量或替代医生、药师建议。所有不确定的药品信息都必须提示以包装说明书、药师或医生指导为准。"
      : "你是家庭物品管理助手，擅长识别日用品、推断合理分类、保质期风险和存储方式。所有结论要保守，并明确不确定性。";
    let body: JsonRecord = config.protocol === "anthropic" ? {
      model: config.model,
      max_tokens: 1400,
      system,
      messages: [{ role: "user", content: imageUrl ? [{ type: "text", text }, { type: "image", source: { type: imageUrl.startsWith("data:") ? "base64" : "url", ...(imageUrl.startsWith("data:") ? { media_type: imageUrl.match(/^data:(image\/[^;]+);/)?.[1] || "image/jpeg", data: imageUrl.split(",")[1] || "" } : { url: imageUrl }) } }] : text }],
      temperature: 0.2,
    } : {
      model: config.model,
      messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const call = (payload: Record<string, unknown>) => fetch(config.protocol === "anthropic" ? anthropicMessagesUrl(config.baseUrl) : chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: config.protocol === "anthropic"
        ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
        : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    let response: Response;
    try {
      response = await call(body);
      for (let attempt = 0; config.protocol === "openai" && !response.ok && attempt < 2 && [400, 422].includes(response.status); attempt += 1) {
        const detail = providerErrorDetail(await response.text());
        const fallback = { ...body };
        let changed = false;
        if ("response_format" in fallback && /response[_ .-]?format|json[_ .-]?object|structured output|unsupported/i.test(detail)) {
          delete fallback.response_format;
          changed = true;
        }
        if ("temperature" in fallback && /temperature|unsupported parameter|not support/i.test(detail)) {
          delete fallback.temperature;
          changed = true;
        }
        if (!changed) return NextResponse.json({ error: `AI 接口错误（${response.status}）：${detail}` }, { status: 502 });
        body = fallback;
        response = await call(body);
      }
    } catch (error) {
      return NextResponse.json({ error: connectionError(error, config.baseUrl) }, { status: 502 });
    }
    if (!response.ok) return NextResponse.json({ error: providerFailure(response.status, await response.text()) }, { status: 502 });
    const raw = await response.text();
    let result: JsonRecord;
    try {
      result = asRecord(JSON.parse(raw)) ?? {};
    } catch {
      return NextResponse.json({ error: `AI 接口返回了非 JSON 响应：${providerErrorDetail(raw)}` }, { status: 502 });
    }
    return NextResponse.json({ analysis: extractAnalysis(result), model: typeof result.model === "string" ? result.model : config.model });
  } catch (error) {
    if (error instanceof AiRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiError(error);
  }
}
