"use client";

import { Bot, Check, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

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

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await jsonRequest("/api/settings/ai", { method: "PATCH", body: JSON.stringify(form) });
      setForm((old) => ({ ...old, configured: true, apiKeyConfigured: true, apiKey: "" }));
      onToast("AI 接口设置已保存");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return <section className="surface rounded-3xl p-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="m-0 flex items-center gap-2 text-base"><Bot size={18} style={{ color: "var(--primary)" }} />AI 物品助手</h3>
        <p className="mb-0 mt-1 text-xs muted">支持 OpenAI Chat Completions 兼容接口与视觉模型。</p>
      </div>
      <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: form.configured ? "#e0f7ef" : "var(--surface-soft)", color: form.configured ? "var(--success)" : "var(--muted)" }}>{loading ? "检测中" : form.configured ? "已配置" : "未配置"}</span>
    </div>

    {!loading && <form onSubmit={save} className="mt-5 space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold muted">接口地址</span>
        <input required disabled={form.managedByEnvironment} className="input" value={form.baseUrl} onChange={(event) => setForm((old) => ({ ...old, baseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" />
        <span className="mt-1.5 block text-[11px] leading-5 muted">填写兼容接口的 Base URL，通常以 /v1 结尾。Docker 中不要使用 localhost 访问宿主机服务。</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block" ref={modelMenuRef}>
          <span className="mb-1.5 block text-xs font-bold muted">模型</span>
          <div className="relative">
            <button type="button" disabled={form.managedByEnvironment} onClick={toggleModels} className="input flex items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-70" aria-haspopup="listbox" aria-expanded={modelsOpen}>
              <span className="truncate">{form.model}</span>
              {modelsLoading ? <LoaderCircle className="shrink-0 animate-spin" size={17} /> : <ChevronDown className={`shrink-0 transition-transform ${modelsOpen ? "rotate-180" : ""}`} size={17} />}
            </button>
            {modelsOpen && <div className="surface absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl p-1.5 shadow-2xl" role="listbox">
              {modelsLoading ? <div className="flex items-center gap-2 px-3 py-3 text-xs muted"><LoaderCircle className="animate-spin" size={15} />正在拉取模型列表…</div>
                : modelsError ? <div className="p-2"><p className="m-0 px-1 text-xs leading-5 text-red-500">{modelsError}</p><button type="button" onClick={() => void loadModels()} className="btn-ghost mt-2 flex w-full items-center justify-center gap-2 py-2 text-xs"><RefreshCw size={14} />重新拉取</button></div>
                  : models.map((model) => <button key={model} type="button" role="option" aria-selected={form.model === model} onClick={() => { setForm((old) => ({ ...old, model })); setModelsOpen(false); }} className="flex w-full items-center justify-between gap-2 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm hover:bg-[var(--primary-soft)]"><span className="truncate">{model}</span>{form.model === model && <Check size={15} style={{ color: "var(--primary)" }} />}</button>)}
            </div>}
          </div>
          <span className="mt-1.5 block text-[11px] leading-5 muted">展开后会使用当前接口地址和 API Key 自动获取可用模型。</span>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold muted">API Key</span>
          <input disabled={form.managedByEnvironment} type="password" className="input" value={form.apiKey} onChange={(event) => setForm((old) => ({ ...old, apiKey: event.target.value }))} placeholder={form.apiKeyConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" />
          <span className="mt-1.5 block text-[11px] leading-5 muted">若拉取模型时提示 401，请重新复制正确的 Key，注意不要带空格。</span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="m-0 text-[11px] leading-5 muted">建议选择支持图片输入的模型，以启用拍照识别和包装保质期分析。</p>
        {form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">{saving ? "保存中…" : "保存 AI"}</button>}
      </div>
    </form>}
  </section>;
}
