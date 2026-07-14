import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { aiAnalyzeSchema } from "@/lib/validation";

export const runtime = "nodejs";

function extractJson(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
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
    const body = {
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
    let response = await call(body);
    if (!response.ok && response.status === 400) {
      const detail = await response.text();
      if (/response.format|json.object|unsupported/i.test(detail)) {
        const { response_format: _, ...fallbackBody } = body;
        void _;
        response = await call(fallbackBody);
      } else return NextResponse.json({ error: `AI 接口错误：${detail.slice(0, 300)}` }, { status: 502 });
    }
    if (!response.ok) return NextResponse.json({ error: `AI 接口请求失败（${response.status}）：${(await response.text()).slice(0, 300)}` }, { status: 502 });
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") return NextResponse.json({ error: "AI 接口未返回可解析内容" }, { status: 502 });
    return NextResponse.json({ analysis: extractJson(content), model: result.model || config.model });
  } catch (error) {
    return apiError(error);
  }
}
