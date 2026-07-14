"use client";

import { Bot } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

type AiForm = { configured: boolean; managedByEnvironment: boolean; baseUrl: string; model: string; apiKeyConfigured: boolean; apiKey: string };
const initialForm: AiForm = { configured: false, managedByEnvironment: false, baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKeyConfigured: false, apiKey: "" };

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
  useEffect(() => {
    let active = true;
    jsonRequest<Omit<AiForm, "apiKey">>("/api/settings/ai").then((result) => { if (active) setForm({ ...result, apiKey: "" }); }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { await jsonRequest("/api/settings/ai", { method: "PATCH", body: JSON.stringify(form) }); setForm((old) => ({ ...old, configured: true, apiKeyConfigured: true, apiKey: "" })); onToast("AI 接口设置已保存"); } catch (error) { onToast(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); } };
  return <section className="surface rounded-3xl p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="m-0 flex items-center gap-2 text-base"><Bot size={18} style={{ color: "var(--primary)" }} />AI 物品助手</h3><p className="mb-0 mt-1 text-xs muted">支持 OpenAI Chat Completions 兼容接口与视觉模型。</p></div><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: form.configured ? "#e0f7ef" : "var(--surface-soft)", color: form.configured ? "var(--success)" : "var(--muted)" }}>{loading ? "检测中" : form.configured ? "已配置" : "未配置"}</span></div>
    {!loading && <form onSubmit={save} className="mt-5 space-y-3"><label className="block"><span className="mb-1.5 block text-xs font-bold muted">接口地址</span><input required disabled={form.managedByEnvironment} className="input" value={form.baseUrl} onChange={(e) => setForm((old) => ({ ...old, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-bold muted">模型</span><input required disabled={form.managedByEnvironment} className="input" value={form.model} onChange={(e) => setForm((old) => ({ ...old, model: e.target.value }))} placeholder="gpt-4.1-mini" /></label><label className="block"><span className="mb-1.5 block text-xs font-bold muted">API Key</span><input disabled={form.managedByEnvironment} type="password" className="input" value={form.apiKey} onChange={(e) => setForm((old) => ({ ...old, apiKey: e.target.value }))} placeholder={form.apiKeyConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" /></label></div><div className="flex items-center justify-between gap-3 pt-1"><p className="m-0 text-[11px] leading-5 muted">建议选择支持图片输入的模型，以启用拍照识别和包装保质期分析。</p>{form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">{saving ? "保存中…" : "保存 AI"}</button>}</div></form>}
  </section>;
}
