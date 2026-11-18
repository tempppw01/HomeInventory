// AI 分析的共用部分:结果解析、错误文案、以及「后台自动分析」用的精简调用。
// 这里只放无副作用的纯逻辑与一次模型调用,不碰 cookies / NextRequest,方便被路由与后台队列共用。
import { aiFetch, chatCompletionsUrl, type AiConfig } from "@/lib/ai";
export type JsonRecord = Record<string, unknown>;

export class AiRequestError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

export function extractJson(content: string): JsonRecord {
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

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join("\n");
  const record = asRecord(content);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (record.content !== undefined) return contentText(record.content);
  return "";
}

export function extractAnalysis(result: unknown) {
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

export function providerErrorDetail(raw: string) {
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

export function providerFailure(status: number, raw: string) {
  const detail = providerErrorDetail(raw);
  if (status === 401) return `API Key 无效或已过期，请在设置中重新填写后再试。上游返回：${detail}`;
  if (status === 403) return `API Key 没有访问当前模型的权限。上游返回：${detail}`;
  return `AI 接口请求失败（${status}）：${detail}`;
}

export function connectionError(error: unknown, baseUrl: string) {
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

export type AnalyzeInput = {
  name: string;
  category: string;
  type: "DURABLE" | "CONSUMABLE";
  unit: string;
  quantity: number;
  minQuantity?: number;
  expiryDate?: string | null;
  purchaseDate?: string | null;
  notes?: string | null;
  locationName?: string | null;
};

/**
 * 后台自动分析:给刚入库的物品生成摘要与建议。
 * 和交互式分析的区别:不带图片、不做多轮能力降级,只求一条稳定可用的结论。
 * 调用方(队列)负责限流与写库,这里失败直接抛错,由调用方决定是否重试。
 */
export async function analyzeItemInBackground(config: AiConfig, input: AnalyzeInput) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = [
    `今天是 ${today}。请分析这件家庭物品,给出简短、可执行的结论。`,
    `物品信息:${JSON.stringify(input)}`,
    "输入要求:",
    "1. summary 一句话说清这是什么、当前要留意什么;",
    "2. storageAdvice 写怎么存放(需要冷藏就直接说);",
    "3. usageAdvice 写怎么用、先后顺序;",
    "4. replenishmentAdvice 写什么时候补货;",
    "5. 不确定就说不确定,不要编造包装上的信息;",
    '6. 只输出 JSON:{"summary":"","storageAdvice":"","usageAdvice":"","replenishmentAdvice":"","confidence":0.8}',
  ].join("\n");

  const response = await aiFetch(chatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    }),
  }, { attempts: 2, timeoutMs: 40000 });

  if (!response.ok) throw new Error(providerFailure(response.status, await response.text()));
  const raw = await response.text();
  let parsed: JsonRecord;
  try {
    parsed = asRecord(JSON.parse(raw)) ?? {};
  } catch {
    throw new Error(`AI 接口返回了非 JSON 响应:${providerErrorDetail(raw)}`);
  }
  const content = contentText((parsed.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content);
  const analysis = extractJson(content);
  if (!analysis.summary) throw new Error("AI 没有给出可用摘要");
  return { analysis, model: typeof parsed.model === "string" ? parsed.model : config.model };
}
