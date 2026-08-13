import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { anthropicMessagesUrl, chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Message = { role: "user" | "assistant"; content: string };
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (value && typeof value === "object") { const item = value as Record<string, unknown>; return textOf(item.text ?? item.content); }
  return "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const messages = Array.isArray(body.messages) ? body.messages.filter((entry: unknown): entry is Message => Boolean(entry && typeof entry === "object" && ["user", "assistant"].includes((entry as Message).role) && typeof (entry as Message).content === "string")).slice(-12) : [];
    const question = messages.at(-1)?.content?.trim();
    if (!question) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
    const config = await getAiConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中配置 AI 接口" }, { status: 400 });
    const [items, locations, shopping] = await Promise.all([
      prisma.item.findMany({ where: { deletedAt: null }, include: { location: true }, orderBy: { updatedAt: "desc" } }),
      prisma.location.findMany({ orderBy: { name: "asc" } }),
      prisma.shoppingItem.findMany({ where: { status: "PENDING" }, orderBy: { priority: "desc" } }),
    ]);
    const inventory = JSON.stringify({ items: items.map((item) => ({ name: item.name, category: item.category, type: item.type, quantity: item.quantity, unit: item.unit, location: item.location?.name || "未设置", expiryDate: item.expiryDate, remainingPercent: item.remainingPercent })), locations: locations.map((location) => location.name), pendingShopping: shopping.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit })) });
    const system = `你是家庭库存助手。只能依据下面的库存数据回答，不要臆造不存在的物品。回答中文，简洁直接；用户问位置时明确说出位置，未设置位置要如实说明。可以给出补货、过期和整理建议，但要标注这是建议。当前库存数据：${inventory}`;
    const call = (payload: Record<string, unknown>) => fetch(config.protocol === "anthropic" ? anthropicMessagesUrl(config.baseUrl) : chatCompletionsUrl(config.baseUrl), { method: "POST", headers: config.protocol === "anthropic" ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
    const response = await call(config.protocol === "anthropic" ? { model: config.model, max_tokens: 1000, system, messages: messages.map((message: Message) => ({ role: message.role, content: message.content })) } : { model: config.model, messages: [{ role: "system", content: system }, ...messages], temperature: 0.2 });
    const raw = await response.text();
    if (!response.ok) return NextResponse.json({ error: `AI 接口请求失败（${response.status}）` }, { status: 502 });
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: "AI 返回格式不正确" }, { status: 502 }); }
    const root = parsed as Record<string, unknown>;
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined;
    const answer = config.protocol === "anthropic" ? textOf(root.content) : textOf(message && typeof message === "object" ? (message as Record<string, unknown>).content : root.output_text);
    if (!answer) return NextResponse.json({ error: "AI 没有返回回答" }, { status: 502 });
    return NextResponse.json({ answer });
  } catch (error) { return apiError(error); }
}
