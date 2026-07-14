import { prisma } from "@/lib/prisma";

export type AiConfig = { baseUrl: string; apiKey: string; model: string };

export function aiIsManagedByEnvironment() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL);
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const stored = await prisma.aiSetting.findUnique({ where: { id: "default" } });
  const config = {
    baseUrl: (process.env.OPENAI_BASE_URL || stored?.baseUrl || "").replace(/\/$/, ""),
    apiKey: process.env.OPENAI_API_KEY || stored?.apiKey || "",
    model: process.env.OPENAI_MODEL || stored?.model || "",
  };
  return config.baseUrl && config.apiKey && config.model ? config : null;
}

export function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  return normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}
