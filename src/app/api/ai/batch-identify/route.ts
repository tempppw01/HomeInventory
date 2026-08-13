import { NextRequest, NextResponse } from "next/server";
import { anthropicMessagesUrl, chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
const maxImages = 8;
function textOf(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(textOf).join("\n"); if (value && typeof value === "object") { const item = value as Record<string, unknown>; return textOf(item.text ?? item.content); } return ""; }
function parseJson(text: string): unknown[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).items)) return (parsed as Record<string, unknown>).items as unknown[];
  throw new Error("AI 返回格式不正确");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const images = Array.isArray(body.images) ? body.images.filter((image: unknown) => typeof image === "object" && image !== null && typeof (image as Record<string, unknown>).dataUrl === "string").slice(0, maxImages) as { dataUrl: string; fileName?: string }[] : [];
    if (!images.length) return NextResponse.json({ error: "请至少上传一张图片" }, { status: 400 });
    if (images.some((image) => !image.dataUrl.startsWith("data:image/"))) return NextResponse.json({ error: "图片格式不正确" }, { status: 400 });
    const config = await getAiConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中配置 AI 接口" }, { status: 400 });
    const instruction = "识别图片中清晰可见的家庭物品，每张图片对应一个物品；如果一张图有多个物品，分别列出。只返回 JSON 对象 {\"items\":[...]}，不要 Markdown。每项字段：sourceIndex(图片序号，从0开始), name, category(日用/食品/饮品/清洁/家电/数码/衣物/医药/户外/其他), type(DURABLE或CONSUMABLE), quantity(数字), unit, purchaseDate(YYYY-MM-DD或null), expiryDate(YYYY-MM-DD或null), notes, confidence(0到1)。sourceIndex 必须对应识别该物品的图片；耐用品 expiryDate 必须为 null，不确定的字段保守填写。图片无法判断购买日期时 purchaseDate 返回 null。";
    const content = [{ type: "text", text: instruction }, ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl, detail: "low" } }))];
    const payload = config.protocol === "anthropic"
      ? { model: config.model, max_tokens: 1800, messages: [{ role: "user", content: [{ type: "text", text: instruction }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.dataUrl.match(/^data:(image\/[^;]+);/)?.[1] || "image/jpeg", data: image.dataUrl.split(",")[1] || "" } }))] }] }
      : { model: config.model, messages: [{ role: "user", content }], temperature: 0.1, response_format: { type: "json_object" } };
    const response = await fetch(config.protocol === "anthropic" ? anthropicMessagesUrl(config.baseUrl) : chatCompletionsUrl(config.baseUrl), { method: "POST", headers: config.protocol === "anthropic" ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    const raw = await response.text();
    if (!response.ok) return NextResponse.json({ error: `AI 接口请求失败（${response.status}）` }, { status: 502 });
    const root = JSON.parse(raw) as Record<string, unknown>; const choices = Array.isArray(root.choices) ? root.choices : []; const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined; const answer = config.protocol === "anthropic" ? textOf(root.content) : textOf(message && typeof message === "object" ? (message as Record<string, unknown>).content : root.output_text); const records = parseJson(answer);
    return NextResponse.json({ items: records.slice(0, 30).map((item) => { const record = item as Record<string, unknown>; const sourceIndex = Number(record.sourceIndex); return { ...record, sourceIndex: Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < images.length ? sourceIndex : 0, quantity: Number(record.quantity) > 0 ? Number(record.quantity) : 1, confidence: Number(record.confidence) || 0 }; }) });
  } catch (error) { return apiError(error); }
}
