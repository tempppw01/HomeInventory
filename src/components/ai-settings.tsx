"use client";

import { Bot, Check, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/components/provider-icon";
import { AI_PROVIDER_PRESETS, providerForBaseUrl, providerForModel } from "@/lib/ai-providers";

type AiForm = {
  configured: boolean;
  managedByEnvironment: boolean;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKey: string;
};

const initialForm: AiForm = {
  configured: false,
  managedByEnvironment: false,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.5",
  apiKeyConfigured: false,
  apiKey: "",
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作失败");
  return body;
}

export function AiSettings({ onToast }: { onToast: (message: string) => void }) {
  const [form, setForm] = useState<AiForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const provider = useMemo(() => providerForBaseUrl(form.baseUrl), [form.baseUrl]);

  useEffect(() => {
    let active = true;
    jsonRequest<Omit<AiForm, "apiKey">>("/api/settings/ai")
      .then((result) => { if (active) setForm({ ...result, apiKey: "" }); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!modelsOpen) return;
    const close = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelsOpen]);

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const result = await jsonRequest<{ models: string[] }>("/api/settings/ai/models", {
        method: "POST",
        body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey }),
      });
      setModels(result.models);
    } catch (error) {
      setModels([]);
      setModelsError(error instanceof Error ? error.message : "模型列表拉取失败");
    } finally {
      setModelsLoading(false);
    }
  };

  const toggleModels = () => {
    if (form.managedByEnvironment) return;
    const next = !modelsOpen;
    setModelsOpen(next);
    if (next) void loadModels();
  };

  const chooseProvider = (id: (typeof AI_PROVIDER_PRESETS)[number]["id"]) => {
    const preset = AI_PROVIDER_PRESETS.find((entry) => entry.id === id);
    if (!preset || form.managedByEnvironment) return;
    setForm((old) => ({ ...old, baseUrl: preset.baseUrl, model: preset.defaultModel }));
    setModels([]);
    setModelsError("");
    setModelsOpen(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await jsonRequest("/api/settings/ai", { method: "PATCH", body: JSON.stringify(form) });
      setForm((old) => ({ ...old, configured: true, apiKeyConfigured: true, apiKey: "" }));
      onToast(`${provider.name} 接口设置已保存`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return <details className="surface group rounded-3xl p-5">
    <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
      <div className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)" }}>
        {provider.id === "custom" ? <Bot size={20} style={{ color: "var(--primary)" }} /> : <ProviderIcon provider={provider.id} size={21} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-sm font-black">AI 模型与识别</h3>
        <p className="mb-0 mt-1 truncate text-xs muted">{loading ? "正在检测配置" : form.configured ? `${provider.name} · ${form.model}` : "选择供应商并配置模型"}</p>
      </div>
      <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: form.configured ? "#e0f7ef" : "var(--surface-soft)", color: form.configured ? "var(--success)" : "var(--muted)" }}>{form.configured ? "已配置" : "未配置"}</span>
      <ChevronDown size={17} className="muted transition-transform group-open:rotate-180" />
    </summary>

    {!loading && <form onSubmit={save} className="mt-5 space-y-4 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <div>
        <div className="mb-2 text-xs font-bold muted">供应商快捷设置</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {AI_PROVIDER_PRESETS.map((preset) => <button key={preset.id} type="button" title={preset.name} aria-label={`选择 ${preset.name}`} disabled={form.managedByEnvironment} onClick={() => chooseProvider(preset.id)} className="grid h-16 min-w-0 place-items-center rounded-2xl border transition hover:-translate-y-0.5" style={{ borderColor: provider.id === preset.id ? preset.color : "var(--border)", background: provider.id === preset.id ? `color-mix(in srgb, ${preset.color} 10%, var(--surface-solid))` : "var(--surface-soft)", color: provider.id === preset.id ? preset.color : "var(--muted)" }}><ProviderIcon provider={preset.id} size={24} /></button>)}
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-bold muted">接口地址</span>
        <div className="relative"><span className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2">{provider.id === "custom" ? <Bot size={17} className="muted" /> : <ProviderIcon provider={provider.id} size={17} />}</span><input required disabled={form.managedByEnvironment} className="input input-icon" value={form.baseUrl} onChange={(event) => setForm((old) => ({ ...old, baseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" /></div>
        <span className="mt-1.5 block text-[11px] leading-5 muted">快捷项使用各供应商官方端点；自建或中转服务可直接修改。Claude 官方端点会自动使用 Messages 协议。</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block" ref={modelMenuRef}>
          <span className="mb-1.5 block text-xs font-bold muted">模型</span>
          <div className="relative flex">
            <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 flex -translate-y-1/2"><ProviderIcon provider={providerForModel(form.model, form.baseUrl).id} size={17} /></span>
            <input required disabled={form.managedByEnvironment} className="input input-icon input-model" value={form.model} onChange={(event) => setForm((old) => ({ ...old, model: event.target.value }))} />
            <button type="button" disabled={form.managedByEnvironment} onClick={toggleModels} className="grid w-11 shrink-0 place-items-center rounded-r-2xl border disabled:opacity-60" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }} aria-label="拉取并选择模型" aria-haspopup="listbox" aria-expanded={modelsOpen}>{modelsLoading ? <LoaderCircle className="animate-spin" size={17} /> : <ChevronDown className={`transition-transform ${modelsOpen ? "rotate-180" : ""}`} size={17} />}</button>
            {modelsOpen && <div className="surface absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl p-1.5 shadow-2xl" role="listbox">
              {modelsLoading ? <div className="flex items-center gap-2 px-3 py-3 text-xs muted"><LoaderCircle className="animate-spin" size={15} />正在拉取模型列表…</div>
                : modelsError ? <div className="p-2"><p className="m-0 px-1 text-xs leading-5 text-red-500">{modelsError}</p><button type="button" onClick={() => void loadModels()} className="btn-ghost mt-2 flex w-full items-center justify-center gap-2 py-2 text-xs"><RefreshCw size={14} />重新拉取</button></div>
                  : models.map((model) => { const modelProvider = providerForModel(model, form.baseUrl); return <button key={model} type="button" role="option" aria-selected={form.model === model} onClick={() => { setForm((old) => ({ ...old, model })); setModelsOpen(false); }} className="flex w-full items-center gap-2 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm hover:bg-[var(--primary-soft)]"><ProviderIcon provider={modelProvider.id} size={16} /><span className="min-w-0 flex-1 truncate">{model}</span>{form.model === model && <Check size={15} style={{ color: "var(--primary)" }} />}</button>; })}
            </div>}
          </div>
          <span className="mt-1.5 block text-[11px] leading-5 muted">点击右侧按钮会用当前地址和 API Key 自动获取模型。</span>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold muted">API Key</span>
          <input disabled={form.managedByEnvironment} type="password" className="input" value={form.apiKey} onChange={(event) => setForm((old) => ({ ...old, apiKey: event.target.value }))} placeholder={form.apiKeyConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" />
          <span className="mt-1.5 block text-[11px] leading-5 muted">密钥只保存在服务端；切换供应商后请填写对应供应商的 Key。</span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="m-0 text-[11px] leading-5 muted">建议选择支持图片输入的模型，以启用拍照识别和包装信息分析。</p>
        {form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">{saving ? "保存中…" : "保存 AI"}</button>}
      </div>
    </form>}
  </details>;
}
