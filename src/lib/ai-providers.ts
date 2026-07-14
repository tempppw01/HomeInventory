export type AiProviderId = "openai" | "deepseek" | "volcengine" | "qwen" | "gemini" | "anthropic" | "custom";
export type AiProtocol = "openai" | "anthropic";

export type AiProviderPreset = {
  id: Exclude<AiProviderId, "custom">;
  name: string;
  shortName: string;
  baseUrl: string;
  defaultModel: string;
  icon: string;
  color: string;
  protocol: AiProtocol;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: "openai", name: "OpenAI", shortName: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5.5", icon: "/providers/openai.svg", color: "#10a37f", protocol: "openai" },
  { id: "deepseek", name: "DeepSeek", shortName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", icon: "/providers/deepseek.svg", color: "#4d6bfe", protocol: "openai" },
  { id: "volcengine", name: "火山引擎", shortName: "火山", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-1-6-250615", icon: "/providers/volcengine.svg", color: "#1664ff", protocol: "openai" },
  { id: "qwen", name: "阿里千问", shortName: "千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus", icon: "/providers/qwen.svg", color: "#615ced", protocol: "openai" },
  { id: "gemini", name: "Google Gemini", shortName: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", icon: "/providers/gemini.svg", color: "#4285f4", protocol: "openai" },
  { id: "anthropic", name: "Anthropic Claude", shortName: "Claude", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-5-20250929", icon: "/providers/anthropic.svg", color: "#d97757", protocol: "anthropic" },
];

const customProvider = { id: "custom" as const, name: "自定义兼容接口", shortName: "自定义", baseUrl: "", defaultModel: "", icon: "", color: "#7c3aed", protocol: "openai" as const };

export function providerById(id: AiProviderId) {
  return AI_PROVIDER_PRESETS.find((provider) => provider.id === id) ?? customProvider;
}

export function providerForBaseUrl(baseUrl: string) {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes("api.openai.com")) return providerById("openai");
  if (normalized.includes("deepseek.com")) return providerById("deepseek");
  if (normalized.includes("volces.com") || normalized.includes("volcengine.com")) return providerById("volcengine");
  if (normalized.includes("dashscope.aliyuncs.com")) return providerById("qwen");
  if (normalized.includes("generativelanguage.googleapis.com")) return providerById("gemini");
  if (normalized.includes("api.anthropic.com")) return providerById("anthropic");
  return customProvider;
}

export function providerForModel(model: string, fallbackBaseUrl = "") {
  const normalized = model.toLowerCase();
  if (/^(gpt-|o[134]-|chatgpt-)/.test(normalized)) return providerById("openai");
  if (normalized.includes("deepseek")) return providerById("deepseek");
  if (normalized.includes("doubao") || normalized.includes("skylark")) return providerById("volcengine");
  if (normalized.includes("qwen")) return providerById("qwen");
  if (normalized.includes("gemini")) return providerById("gemini");
  if (normalized.includes("claude")) return providerById("anthropic");
  return providerForBaseUrl(fallbackBaseUrl);
}
