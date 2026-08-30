import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { anthropicMessagesUrl, chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { AiImageError, compressAiImageDataUrl } from "@/lib/ai-image";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Attachment = { kind: "image" | "text" | "file"; name?: string; dataUrl?: string; text?: string };
type Message = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };
type ItemDraft = { name: string; category: string; type: "DURABLE" | "CONSUMABLE"; quantity: number; unit: string; locationName?: string; expiryDate?: string | null; notes?: string };

async function prepareMessageImages(message: Message): Promise<Message> {
  const attachments = await Promise.all((message.attachments || []).map(async (attachment) => {
    if (attachment.kind !== "image" || !attachment.dataUrl) return attachment;
    return { ...attachment, dataUrl: await compressAiImageDataUrl(attachment.dataUrl) };
  }));
  return { ...message, attachments };
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (value && typeof value === "object") { const item = value as Record<string, unknown>; return textOf(item.text ?? item.content); }
  return "";
}

function extractItemDraft(answer: string): { answer: string; itemDraft?: ItemDraft } {
  const match = answer.match(/<item_draft>\s*([\s\S]*?)\s*<\/item_draft>/i);
  if (!match) return { answer };
  const cleanAnswer = answer.replace(match[0], "").trim();
  try {
    const raw = JSON.parse(match[1]) as Partial<ItemDraft>;
    if (typeof raw.name !== "string" || !raw.name.trim()) return { answer: cleanAnswer };
    return {
      answer: cleanAnswer,
      itemDraft: {
        name: raw.name.trim(), category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "其他",
        type: raw.type === "CONSUMABLE" ? "CONSUMABLE" : "DURABLE", quantity: typeof raw.quantity === "number" && Number.isFinite(raw.quantity) ? Math.max(0, raw.quantity) : 1,
        unit: typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : "件", locationName: typeof raw.locationName === "string" ? raw.locationName.trim() : "",
        expiryDate: typeof raw.expiryDate === "string" && raw.expiryDate ? raw.expiryDate : null, notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
      },
    };
  } catch { return { answer: cleanAnswer }; }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const messages: Message[] = Array.isArray(body.messages) ? body.messages.filter((entry: unknown): entry is Message => Boolean(entry && typeof entry === "object" && ["user", "assistant"].includes((entry as Message).role) && typeof (entry as Message).content === "string")).slice(-12).map((message: Message) => ({ ...message, attachments: Array.isArray(message.attachments) ? message.attachments.filter((attachment: Attachment) => attachment && typeof attachment === "object" && ["image", "text", "file"].includes(attachment.kind)).slice(0, 4) : [] })) : [];
    const question = messages.at(-1)?.content?.trim();
    if (!question) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
    const preparedMessages = await Promise.all(messages.map(prepareMessageImages));
    const config = await getAiConfig();
    if (!config) return NextResponse.json({ error: "请先在设置中配置 AI 接口" }, { status: 400 });
    const [items, locations, shopping] = await Promise.all([
      prisma.item.findMany({ where: { deletedAt: null }, include: { location: true }, orderBy: { updatedAt: "desc" } }),
      prisma.location.findMany({ orderBy: { name: "asc" } }),
      prisma.shoppingItem.findMany({ where: { status: "PENDING" }, orderBy: { priority: "desc" } }),
    ]);
    const inventory = JSON.stringify({ items: items.map((item) => ({ name: item.name, category: item.category, type: item.type, quantity: item.quantity, unit: item.unit, location: item.location?.name || "未设置", expiryDate: item.expiryDate, remainingPercent: item.remainingPercent })), locations: locations.map((location) => location.name), pendingShopping: shopping.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit })) });
    let webContext = "";
    if (body.webSearch === true) {
      const query = String(question).slice(0, 160);
      try {
        const searchResponse = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "HomeInventory/1.0" }, signal: AbortSignal.timeout(8000) });
        const html = await searchResponse.text();
        const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g)].slice(0, 5).map((match) => `${match[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")}（${match[1]}）`);
        if (matches.length) webContext = `公开网页搜索结果（仅供参考，价格和库存需用户自行核实）：${matches.join("；")}`;
      } catch { webContext = "联网搜索暂时不可用，请明确说明无法实时核价，不要编造价格。"; }
    }
    const attachmentContext = preparedMessages.flatMap((message: Message) => (message.attachments || []).filter((attachment: Attachment) => attachment.kind !== "image" && attachment.text).map((attachment: Attachment) => `附件 ${attachment.name || "未命名"}：${attachment.text}`)).join("\n");
    const latest = messages.at(-1);
    const intakeIntent = Boolean(latest?.attachments?.some((attachment) => attachment.kind === "image")) || /识别|分析图片|录入|添加物品|入库/.test(question);
    const system = `你是归物助手，负责帮助用户管理家庭物品。只能依据下面的库存数据回答，不要臆造库存中不存在的物品。回答中文，简洁直接，使用纯文本，不要使用 Markdown 粗体星号（**）、井号或表格。用户问位置时明确说出位置，未设置位置要如实说明。${intakeIntent ? `\n这是物品识别/录入场景。请明确告诉用户识别到的物品，并按物品名称、分类、类型（耐用品/消耗品）、建议数量、单位、位置、保质期、备注给出信息。回答末尾必须追加一行严格 JSON 标记：<item_draft>{"name":"物品名","category":"分类","type":"DURABLE或CONSUMABLE","quantity":1,"unit":"件","locationName":"","expiryDate":null,"notes":"备注"}</item_draft>。只为一个主要物品生成草稿；无法判断的位置留空，耐用品保质期为 null，数量必须是数字。` : ""}可以给出补货、过期和整理建议，但要标注这是建议。${webContext ? `\n${webContext}` : ""}${attachmentContext ? `\n用户附件内容：${attachmentContext}` : ""}\n当前库存数据：${inventory}`;
    const call = (payload: Record<string, unknown>) => fetch(config.protocol === "anthropic" ? anthropicMessagesUrl(config.baseUrl) : chatCompletionsUrl(config.baseUrl), { method: "POST", headers: config.protocol === "anthropic" ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
    const toOpenAiContent = (message: Message) => [{ type: "text", text: message.content }, ...(message.attachments || []).filter((attachment: Attachment) => attachment.kind === "image" && attachment.dataUrl).map((attachment: Attachment) => ({ type: "image_url", image_url: { url: attachment.dataUrl, detail: "low" } }))];
    const toAnthropicContent = (message: Message) => [{ type: "text", text: message.content }, ...(message.attachments || []).filter((attachment: Attachment) => attachment.kind === "image" && attachment.dataUrl).map((attachment: Attachment) => ({ type: "image", source: { type: "base64", media_type: attachment.dataUrl!.match(/^data:(image\/[^;]+);/)?.[1] || "image/jpeg", data: attachment.dataUrl!.split(",")[1] || "" } }))];
    const response = await call(config.protocol === "anthropic" ? { model: config.model, max_tokens: 1000, system, messages: preparedMessages.map((message: Message) => ({ role: message.role, content: toAnthropicContent(message) })) } : { model: config.model, messages: [{ role: "system", content: system }, ...preparedMessages.map((message: Message) => ({ role: message.role, content: toOpenAiContent(message) }))], temperature: 0.2 });
    const raw = await response.text();
    if (!response.ok) return NextResponse.json({ error: `AI 接口请求失败（${response.status}）` }, { status: 502 });
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: "AI 返回格式不正确" }, { status: 502 }); }
    const root = parsed as Record<string, unknown>;
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined;
    const answer = config.protocol === "anthropic" ? textOf(root.content) : textOf(message && typeof message === "object" ? (message as Record<string, unknown>).content : root.output_text);
    if (!answer) return NextResponse.json({ error: "AI 没有返回回答" }, { status: 502 });
    return NextResponse.json(extractItemDraft(answer));
  } catch (error) {
    if (error instanceof AiImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiError(error);
  }
}
