import { prisma } from "@/lib/prisma";
import { providerForBaseUrl, type AiProtocol, type AiProviderId } from "@/lib/ai-providers";

export type AiConfig = { baseUrl: string; apiKey: string; model: string; provider: AiProviderId; protocol: AiProtocol };
export const DEFAULT_AI_MODEL = "gpt-5.5";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function hasVersionedApiPath(baseUrl: string) {
  try {
    const path = new URL(baseUrl).pathname.replace(/\/+$/, "");
    return /\/(?:api\/v\d+|v\d+(?:beta)?(?:\/openai)?|compatible-mode\/v\d+)$/i.test(path);
  } catch {
    return /\/(?:api\/v\d+|v\d+(?:beta)?(?:\/openai)?|compatible-mode\/v\d+)$/i.test(baseUrl);
  }
}

export function aiIsManagedByEnvironment() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL);
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const stored = await prisma.aiSetting.findUnique({ where: { id: "default" } });
  const config = {
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || stored?.baseUrl || ""),
    apiKey: (process.env.OPENAI_API_KEY || stored?.apiKey || "").trim(),
    model: (process.env.OPENAI_MODEL || stored?.model || DEFAULT_AI_MODEL).trim(),
  };
  const provider = providerForBaseUrl(config.baseUrl);
  return config.baseUrl && config.apiKey && config.model ? { ...config, provider: provider.id, protocol: provider.protocol } : null;
}

/**
 * 带超时与网络错误重试的 AI 请求。
 * 上游渠道偶发 UND_ERR_SOCKET / ECONNRESET / 超时,这类错误重试一次通常就好了;
 * 之前只对 HTTP 4xx 做能力降级,网络错误直接抛给用户,表现为「转圈半天然后失败」。
 */
export async function aiFetch(input: string, init: RequestInit, options: { attempts?: number; timeoutMs?: number } = {}) {
  const attempts = Math.max(1, options.attempts ?? 2);
  const timeoutMs = Math.max(5000, options.timeoutMs ?? 45000);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = error;
      const code = String((error as { cause?: { code?: string } })?.cause?.code ?? "");
      const name = String((error as Error)?.name ?? "");
      const retryable = /UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(code) || name === "TimeoutError" || name === "AbortError";
      if (!retryable || attempt === attempts - 1) break;
      // 线性退避,避免上游抖动时连续打满。
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}
export function chatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) return normalized;
  return hasVersionedApiPath(normalized) ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

export function anthropicMessagesUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl).replace(/\/messages$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

export function modelsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl).replace(/\/chat\/completions$/, "");
  if (normalized.endsWith("/models")) return normalized;
  return hasVersionedApiPath(normalized) ? `${normalized}/models` : `${normalized}/v1/models`;
}
