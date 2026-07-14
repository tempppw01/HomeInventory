import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { aiAnalyzeSchema } from "@/lib/validation";

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
  const text = contentText(message?.content) || contentText(choice?.text) || contentText(root?.output_text) || contentText(root?.output);
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
    const input = aiAnalyzeSchema.parse(await request.json());
    const config = await getAiConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中配置 OpenAI 兼容接口" }, { status: 400 });

    const task = input.action === "identify" ? "识别或纠正物品基本信息" : input.action === "shelf_life" ? "分析保质期和到期风险" : "完成全面的家庭库存分析";
    const text = `当前日期：${new Date().toISOString().slice(0, 10)}\n任务：${task}\n现有物品信息：${JSON.stringify(input.item || {})}\n用户补充：${input.hint || "无"}\n请返回严格 JSON，不要 Markdown。字段：name, category, type(DURABLE或CONSUMABLE), unit, suggestedExpiryDate(YYYY-MM-DD或null), shelfLifeDays(数字或null), expiryReason, storageAdvice, usageAdvice, replenishmentAdvice, suggestedNotes, confidence(0到1), summary。不能确认时保留现有值或返回 null，不要虚构精确保质期。`;
    const userContent = input.imageUrl
      ? [{ type: "text", text }, { type: "image_url", image_url: { url: input.imageUrl, detail: "low" } }]
      : text;
    let body: JsonRecord = {
      model: config.model,
      messages: [
        { role: "system", content: "你是家庭物品管理助手，擅长识别日用品、推断合理分类、保质期风险和存储方式。所有结论要保守，并明确不确定性。" },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const call = (payload: Record<string, unknown>) => fetch(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    let response: Response;
    try {
      response = await call(body);
      for (let attempt = 0; !response.ok && attempt < 2 && [400, 422].includes(response.status); attempt += 1) {
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
    if (!response.ok) return NextResponse.json({ error: `AI 接口请求失败（${response.status}）：${providerErrorDetail(await response.text())}` }, { status: 502 });
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
