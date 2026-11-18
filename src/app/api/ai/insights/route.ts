import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { aiFetch, chatCompletionsUrl, getAiConfig } from "@/lib/ai";
import { restockForecast } from "@/lib/item-forecast";

/**
 * 概览页的「AI 本周建议」。
 *
 * 这里刻意做成 GET:前端只要打开概览就会自动拉一次,用户不需要点任何按钮。
 * 生成成本不低,所以用内存缓存(默认 10 分钟)+ 数据指纹:库存没变化就直接返回上次结果。
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({ force: z.coerce.boolean().optional() });

type Insight = { title: string; detail: string; action?: string };
type Payload = { headline: string; insights: Insight[]; generatedAt: string; model: string; cached: boolean };

// 单进程内的简易缓存(Next standalone 常驻进程,够用;多副本部署时各实例各自缓存也安全)。
const cache = new Map<string, { fingerprint: string; payload: Payload; at: number }>();
const TTL_MS = 10 * 60 * 1000;

function fingerprintOf(items: Array<{ id: string; quantity: number; expiryDate: Date | null; updatedAt: Date }>) {
  return items
    .map((item) => `${item.id}:${item.quantity}:${item.expiryDate?.toISOString() ?? ""}:${item.updatedAt.toISOString()}`)
    .sort()
    .join("|");
}

function parseInsights(raw: string): { headline: string; insights: Insight[] } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { headline?: unknown; insights?: unknown };
    const insights = Array.isArray(parsed.insights)
      ? parsed.insights
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
          .map((entry) => ({ title: String(entry.title ?? "").slice(0, 40), detail: String(entry.detail ?? "").slice(0, 120), action: entry.action ? String(entry.action).slice(0, 20) : undefined }))
          .filter((entry) => entry.title && entry.detail)
          .slice(0, 3)
      : [];
    if (!insights.length) return null;
    return { headline: String(parsed.headline ?? "这周可以这样安排").slice(0, 40), insights };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const config = await getAiConfig();
    if (!config) return NextResponse.json({ error: "AI 未配置" }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const force = querySchema.parse({ force: searchParams.get("force") ?? undefined }).force;

    const items = await prisma.item.findMany({
      where: { deletedAt: null, quantity: { gt: 0 } },
      select: { id: true, name: true, category: true, type: true, unit: true, quantity: true, remainingPercent: true, expiryDate: true, updatedAt: true, consumeRate: true, minQuantity: true },
      orderBy: { updatedAt: "desc" },
      take: 60,
    });
    if (!items.length) return NextResponse.json({ error: "库存为空" }, { status: 400 });

    const fingerprint = fingerprintOf(items);
    const cached = cache.get(user.id);
    if (!force && cached && cached.fingerprint === fingerprint && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json({ ...cached.payload, cached: true });
    }

    const now = Date.now();
    const expiring = items.filter((item) => item.expiryDate && item.expiryDate.getTime() - now < 7 * 86400000).map((item) => ({ name: item.name, days: Math.round((item.expiryDate!.getTime() - now) / 86400000) }));
    const forecast = restockForecast(items.map((item) => ({
      id: item.id, name: item.name, category: item.category, type: item.type, unit: item.unit,
      quantity: item.quantity, remainingPercent: item.remainingPercent, consumeRate: item.consumeRate ?? null, expiryDate: item.expiryDate?.toISOString() ?? null,
    })));
    const lowStock = items.filter((item) => item.type === "CONSUMABLE" && item.minQuantity > 0 && item.quantity <= item.minQuantity).map((item) => item.name);

    const snapshot = {
      物品总数: items.length,
      即将到期: expiring.slice(0, 6),
      按用量快用完: forecast.slice(0, 6).map((row) => ({ 名称: row.name, 还能用几天: row.daysLeft })),
      低于最低库存: lowStock.slice(0, 6),
      分类分布: [...new Set(items.map((item) => item.category))].slice(0, 10),
    };

    const prompt = [
      "你在帮一个中国家庭整理家里的物品库存。根据下面的数据,给出这周最值得做的 3 件事。",
      "要求:",
      "1. 只讲这家人现在能立刻做的事,具体到物品名;",
      "2. 每条一句话,不要太长,语气像家人提醒,不要用「建议您」「请务必」这种客套话;",
      "3. 不要编造数据里没有的物品;没有可说的就少说几条。",
      '只输出 JSON:{"headline":"一句话总结","insights":[{"title":"不超过 8 字","detail":"不超过 40 字","action":"一个短语"}]}',
      `数据:${JSON.stringify(snapshot)}`,
    ].join("\n");

    const response = await aiFetch(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0.4, messages: [{ role: "user", content: prompt }] }),
    }, { attempts: 2, timeoutMs: 40000 });

    if (!response.ok) return NextResponse.json({ error: `AI 接口错误(${response.status})` }, { status: 502 });
    const raw = await response.text();
    let content = "";
    try {
      const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
      const value = parsed.choices?.[0]?.message?.content;
      content = typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text?: unknown }).text ?? "") : "")).join("") : "";
    } catch {
      return NextResponse.json({ error: "AI 返回了非 JSON 响应" }, { status: 502 });
    }

    const parsedInsight = parseInsights(content);
    if (!parsedInsight) return NextResponse.json({ error: "AI 没给出可用建议,稍后再试" }, { status: 502 });

    const payload: Payload = {
      headline: parsedInsight.headline,
      insights: parsedInsight.insights,
      generatedAt: new Date().toISOString(),
      model: config.model,
      cached: false,
    };
    cache.set(user.id, { fingerprint, payload, at: Date.now() });
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error);
  }
}