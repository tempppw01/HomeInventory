import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { aiFetch, anthropicMessagesUrl, chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { aiAnalyzeSchema } from "@/lib/validation";
import { localUploadDataUrl } from "@/lib/oss";
import { AiImageError, compressAiImageDataUrl } from "@/lib/ai-image";
import { rateLimit } from "@/lib/rate-limit";
import { AiRequestError, asRecord, connectionError, extractAnalysis, providerErrorDetail, providerFailure, type JsonRecord } from "@/lib/ai-analyze";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const guard = rateLimit(`ai-analyze:${user.id}`, 20, 60_000);
    if (!guard.ok) return NextResponse.json({ error: `AI 请求较频繁，请 ${guard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(guard.retryAfter) } });
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
    // Local uploads are read into memory for the provider; normalize them through
    // the same image pipeline used by chat so oversized photos do not trigger
    // provider 413/context errors. Remote OSS URLs remain remote URLs.
    const localImageUrl = await localUploadDataUrl(input.imageUrl);
    let imageUrl = localImageUrl || input.imageUrl;
    // Data URLs can come directly from the browser (for example, before an
    // upload finishes). Compress those as well; remote URLs are left intact so
    // providers can fetch them without adding server-side bandwidth usage.
    if (imageUrl?.startsWith("data:image/")) imageUrl = await compressAiImageDataUrl(imageUrl);
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

    const call = (payload: Record<string, unknown>) => aiFetch(config.protocol === "anthropic" ? anthropicMessagesUrl(config.baseUrl) : chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: config.protocol === "anthropic"
        ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
        : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(payload),
    }, { attempts: 2, timeoutMs: 45000 });
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
    if (error instanceof AiImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiError(error);
  }
}
