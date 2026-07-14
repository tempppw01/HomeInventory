import { providerById, type AiProviderId } from "@/lib/ai-providers";

export function ProviderIcon({ provider, size = 18, className = "" }: { provider: AiProviderId; size?: number; className?: string }) {
  const preset = providerById(provider);
  if (!preset.icon) return <span className={`grid place-items-center rounded-md text-[10px] font-black text-white ${className}`} style={{ width: size, height: size, background: preset.color }}>AI</span>;
  return <span aria-hidden="true" title={preset.name} className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size, backgroundColor: preset.color, mask: `url(${preset.icon}) center / contain no-repeat`, WebkitMask: `url(${preset.icon}) center / contain no-repeat` }} />;
}
