"use client";

import { Bot, Check, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/components/provider-icon";
import { SettingsActions, SettingsBadge, SettingsRow, SettingsSection } from "@/components/settings-primitives";
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
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelOptionsRef = useRef<(HTMLButtonElement | null)[]>([]);
  // 「这次打开要不要把焦点送进列表」——只在打开时置位,避免每次重渲染都抢焦点。
  const focusFirstOption = useRef(false);
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

  /**
   * 模型选择器的键盘模型。
   *
   * 此前这个下拉写着 aria-haspopup="listbox" + role="listbox" + role="option",
   * 却**一条键盘交互都没有**:实测打开后焦点还留在触发按钮上,方向键不动、
   * Esc 也关不掉(只有一个「点外面关闭」的监听)。读屏会明确告诉用户这是列表、
   * 应该用方向键选,用户按下去却毫无反应 —— 契约写了就得兑现。
   *
   * 现在按 ARIA listbox 的惯常做法:打开就把焦点送进列表(选中项优先),
   * ↑/↓ 上下移动并回卷,Home/End 到首尾,Esc 关闭并把焦点还给触发按钮,Tab 关闭后继续往后走。
   */
  useEffect(() => {
    if (!modelsOpen || !focusFirstOption.current) return;
    const index = models.findIndex((model) => model === form.model);
    const target = modelOptionsRef.current[index >= 0 ? index : 0];
    if (!target) return; // 列表还在拉取,等它到位
    target.focus();
    focusFirstOption.current = false;
  }, [modelsOpen, models, form.model]);

  const closeModels = (restoreFocus: boolean) => {
    setModelsOpen(false);
    if (restoreFocus) modelButtonRef.current?.focus();
  };

  const onModelListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closeModels(true); return; }
    if (event.key === "Tab") { setModelsOpen(false); return; }
    const count = models.length;
    if (!count) return;
    const current = modelOptionsRef.current.findIndex((node) => node === document.activeElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % count;
    else if (event.key === "ArrowUp") next = current < 0 ? count - 1 : (current - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    modelOptionsRef.current[next]?.focus();
  };

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
    // 打开时把焦点交给列表;关闭时(再点一次按钮)焦点本来就在按钮上,不用管。
    if (next) { focusFirstOption.current = true; void loadModels(); }
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

  return <SettingsSection
    icon={Bot}
    title="AI 模型与识别"
    summary={loading ? "正在检测配置" : form.configured ? `已配置 · ${form.model}` : "未配置,点开填写接口地址"}
    badge={<SettingsBadge tone={form.configured ? "success" : "muted"}>{loading ? "检测中" : form.configured ? "已配置" : "未配置"}</SettingsBadge>}
  >
    {!loading && <form onSubmit={save}>
      <SettingsRow
        title="供应商快捷设置"
        stacked
        control={<div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
          {AI_PROVIDER_PRESETS.map((preset) => <button key={preset.id} type="button" title={preset.name} aria-label={`选择 ${preset.name}`} disabled={form.managedByEnvironment} onClick={() => chooseProvider(preset.id)} className="grid h-11 min-h-11 min-w-0 place-items-center rounded-2xl border transition hover:-translate-y-0.5" style={{ borderColor: provider.id === preset.id ? preset.color : "var(--border)", background: provider.id === preset.id ? `color-mix(in srgb, ${preset.color} 10%, var(--surface-solid))` : "var(--surface-soft)", color: provider.id === preset.id ? preset.color : "var(--muted)" }}><ProviderIcon provider={preset.id} size={24} /></button>)}
        </div>}
      />

      <SettingsRow
        title="接口地址"
        stacked
        control={<div className="w-full space-y-1.5">
          <div className="relative"><span className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2">{provider.id === "custom" ? <Bot size={17} className="muted" /> : <ProviderIcon provider={provider.id} size={17} />}</span><input required aria-label="接口地址" disabled={form.managedByEnvironment} className="input input-icon" value={form.baseUrl} onChange={(event) => setForm((old) => ({ ...old, baseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" /></div>
          <span className="block text-xs leading-5 muted">快捷项使用各供应商官方端点；自建或中转服务可直接修改。Claude 官方端点会自动使用 Messages 协议。</span>
        </div>}
      />

      <SettingsRow
        title="模型"
        description="点击右侧按钮会用当前地址和 API Key 自动获取模型。"
        stacked
        control={<div className="relative flex w-full" ref={modelMenuRef}>
          <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 flex -translate-y-1/2"><ProviderIcon provider={providerForModel(form.model, form.baseUrl).id} size={17} /></span>
          <input required aria-label="模型" disabled={form.managedByEnvironment} className="input input-icon input-model" value={form.model} onChange={(event) => setForm((old) => ({ ...old, model: event.target.value }))} />
          <button ref={modelButtonRef} type="button" disabled={form.managedByEnvironment} onClick={toggleModels} className="grid w-11 shrink-0 place-items-center rounded-r-2xl border disabled:opacity-60" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }} aria-label="拉取并选择模型" aria-haspopup="listbox" aria-expanded={modelsOpen} aria-controls={modelsOpen ? "ai-model-listbox" : undefined}>{modelsLoading ? <LoaderCircle className="animate-spin" size={17} /> : <ChevronDown className={`transition-transform ${modelsOpen ? "rotate-180" : ""}`} size={17} />}</button>
          {modelsOpen && <div id="ai-model-listbox" role="listbox" aria-label="可选模型" onKeyDown={onModelListKeyDown} className="surface absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl p-1.5 shadow-2xl">
            {modelsLoading ? <div className="flex items-center gap-2 px-3 py-3 text-xs muted"><LoaderCircle className="animate-spin" size={15} />正在拉取模型列表…</div>
              : modelsError ? <div className="p-2"><p className="m-0 px-1 text-xs leading-5 text-red-500">{modelsError}</p><button type="button" onClick={() => void loadModels()} className="btn-ghost mt-2 flex w-full items-center justify-center gap-2 py-2 text-xs"><RefreshCw size={14} />重新拉取</button></div>
                : models.map((model, index) => { const modelProvider = providerForModel(model, form.baseUrl); return <button key={model} ref={(node) => { modelOptionsRef.current[index] = node; }} type="button" role="option" tabIndex={-1} aria-selected={form.model === model} onClick={() => { setForm((old) => ({ ...old, model })); closeModels(true); }} className="flex w-full items-center gap-2 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm hover:bg-[var(--primary-soft)] focus-visible:bg-[var(--primary-soft)]"><ProviderIcon provider={modelProvider.id} size={16} /><span className="min-w-0 flex-1 truncate">{model}</span>{form.model === model && <Check size={15} style={{ color: "var(--primary)" }} />}</button>; })}
          </div>}
        </div>}
      />

      <SettingsRow
        title="API Key"
        description="密钥只保存在服务端；切换供应商后请填写对应供应商的 Key。"
        stacked
        control={<input aria-label="API Key" disabled={form.managedByEnvironment} type="password" className="input" value={form.apiKey} onChange={(event) => setForm((old) => ({ ...old, apiKey: event.target.value }))} placeholder={form.apiKeyConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" />}
      />

      <SettingsActions>
        <p className="m-0 min-w-0 flex-1 text-xs leading-5 muted">建议选择支持图片输入的模型，以启用拍照识别和包装信息分析。</p>
        {form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 text-sm">{saving ? "保存中…" : "保存 AI"}</button>}
      </SettingsActions>
    </form>}
  </SettingsSection>;
}
