import { prisma } from "@/lib/prisma";

export type AiConfig = { baseUrl: string; apiKey: string; model: string };
export const DEFAULT_AI_MODEL = "gpt-5.5";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
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
  return config.baseUrl && config.apiKey && config.model ? config : null;
}

export function chatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) return normalized;
  return normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

export function modelsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl).replace(/\/chat\/completions$/, "");
  if (normalized.endsWith("/models")) return normalized;
  return normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`;
}
