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
