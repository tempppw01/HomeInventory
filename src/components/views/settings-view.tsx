"use client";

import {
  Cloud, Grid2X2, Info, Monitor, Trash2, ClipboardCheck,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AiSettings } from "@/components/ai-settings";
import { DataTools } from "@/components/data-tools";
import { HouseholdPreferences } from "@/components/household-preferences";
import { AccountSettings } from "@/components/account-settings";
import { APP_VERSION } from "@/lib/version";
import { Field } from "@/components/ui";
import {
  SettingsSection, SettingsRow, SettingsSelect, SettingsBadge,
} from "@/components/settings-primitives";
import { ThemeMode, request, PageTitle } from "../shared";
export function SettingsView({ onToast, onAbout, onAudit, onRecycle, theme, onThemeChange, density, motionMode, onDensityChange, onMotionChange }: { onToast: (message: string) => void; onAbout: () => void; onAudit: () => void; onRecycle: () => void; theme: ThemeMode; onThemeChange: (value: ThemeMode) => void; density: "comfortable" | "compact"; motionMode: "standard" | "reduced"; onDensityChange: (value: "comfortable" | "compact") => void; onMotionChange: (value: "standard" | "reduced") => void }) {
  const [database, setDatabase] = useState<{ databaseLabel: string; storageMode: string } | null>(null);
  useEffect(() => { let active = true; request<{ databaseLabel: string; storageMode: string }>("/api/system/info").then((result) => { if (active) setDatabase(result); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <><PageTitle title="设置" action={<div className="flex items-center gap-2"><button onClick={onAudit} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center gap-2 p-0 px-0 sm:flex sm:w-auto sm:px-4" aria-label="进入家庭盘点" title="家庭盘点"><ClipboardCheck size={16} /><span className="hidden sm:inline">盘点</span></button><button onClick={onRecycle} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center gap-2 p-0 px-0 sm:flex sm:w-auto sm:px-4" aria-label="打开回收站" title="回收站"><Trash2 size={16} /><span className="hidden sm:inline">回收站</span></button></div>} /><div className="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
    <AccountSettings onToast={onToast} />
    <AiSettings onToast={onToast} />
    <SettingsSection icon={Monitor} title="显示偏好" summary={[theme === "system" ? "跟随系统" : theme === "light" ? "日间模式" : "夜间模式", density === "compact" ? "紧凑" : "舒适", motionMode === "reduced" ? "减少动效" : "标准动效"].join(" · ")}>
      <SettingsRow title="外观主题" description="跟随系统会随设备的深浅色自动切换。" control={<SettingsSelect ariaLabel="外观主题" value={theme} onChange={onThemeChange} options={[["system", "跟随系统"], ["light", "日间模式"], ["dark", "夜间模式"]] as const} />} />
      <SettingsRow title="界面密度" description="紧凑模式一屏能看到更多物品。" control={<SettingsSelect ariaLabel="界面密度" value={density} onChange={onDensityChange} options={[["comfortable", "舒适"], ["compact", "紧凑"]] as const} />} />
      <SettingsRow title="动效" description="减少动效会关掉位移与过渡动画。" control={<SettingsSelect ariaLabel="动效" value={motionMode} onChange={onMotionChange} options={[["standard", "标准"], ["reduced", "减少动效"]] as const} />} />
    </SettingsSection>
    <HouseholdPreferences onToast={onToast} />
    <DataTools onToast={onToast} />
    <OssSettings onToast={onToast} />
    <SettingsSection icon={Grid2X2} title="数据与部署" summary={database ? `${database.databaseLabel} · ${database.storageMode}` : "正在读取运行环境"}>
      <SettingsRow icon={Grid2X2} title={`当前数据库:${database?.databaseLabel || "检测中..."}`} description={database ? `${database.storageMode} · 可通过 DATABASE_PROVIDER 切换` : "正在读取运行环境"} control={<SettingsBadge tone="primary">{database?.databaseLabel || "检测中"}</SettingsBadge>} />
      <SettingsRow icon={Info} title="关于归物" description={`版本 ${APP_VERSION} · 更新说明与使用提示`} control={<button onClick={onAbout} className="btn-ghost h-11 min-h-11 px-4 text-sm">查看</button>} />
    </SettingsSection>
  </div></>;
}


export type OssForm = { configured: boolean; managedByEnvironment: boolean; storageMode: "local" | "oss" | "both"; localDirectory: string; region: string; endpoint: string; bucket: string; directory: string; accessKeyId: string; accessKeySecretConfigured: boolean; publicBaseUrl: string; accessKeySecret: string };
export const emptyOssForm: OssForm = { configured: false, managedByEnvironment: false, storageMode: "local", localDirectory: "/app/data/uploads", region: "", endpoint: "", bucket: "", directory: "home-inventory", accessKeyId: "", accessKeySecretConfigured: false, publicBaseUrl: "", accessKeySecret: "" };

export function OssSettings({ onToast }: { onToast: (message: string) => void }) {
  const [form, setForm] = useState<OssForm>(emptyOssForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    request<Omit<OssForm, "accessKeySecret">>("/api/settings/oss").then((result) => { if (active) setForm({ ...result, accessKeySecret: "" }); }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const set = (key: keyof OssForm, value: string) => setForm((old) => ({ ...old, [key]: value }));
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { await request("/api/settings/oss", { method: "PATCH", body: JSON.stringify(form) }); setForm((old) => ({ ...old, configured: true, accessKeySecretConfigured: true, accessKeySecret: "" })); onToast("OSS 设置已保存"); } catch (error) { onToast(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); } };
  const needsOss = form.storageMode === "oss" || form.storageMode === "both";
  return <SettingsSection icon={Cloud} title="图片存储" summary={form.storageMode === "local" ? "本地目录 · 图片随数据卷持久化" : form.configured ? `${form.bucket}/${form.directory}` : "OSS / 本地目录"} badge={<SettingsBadge tone={form.configured ? "success" : "muted"}>{loading ? "检测中" : form.configured ? "已配置" : "未配置"}</SettingsBadge>}>
    {!loading && <form onSubmit={save} className="space-y-3"><Field label="保存方式"><SettingsSelect ariaLabel="保存方式" disabled={form.managedByEnvironment} value={form.storageMode} onChange={(value) => set("storageMode", value)} options={[["local", "仅本地目录(推荐,免 OSS)"], ["oss", "仅 OSS"], ["both", "本地目录 + OSS(双写)"]] as const} /></Field><Field label="本地图片目录"><input disabled={form.managedByEnvironment} className="input" value={form.localDirectory} onChange={(e) => set("localDirectory", e.target.value)} placeholder="/app/data/uploads" /><span className="mt-1.5 block text-xs leading-5 muted">Docker 中建议使用 /app/data/uploads，图片会随 home_inventory_data 卷持久化。</span></Field>{needsOss && <><div className="grid gap-3 sm:grid-cols-2"><Field label="Region"><input required disabled={form.managedByEnvironment} className="input" value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="oss-cn-hangzhou" /></Field><Field label="Bucket"><input required disabled={form.managedByEnvironment} className="input" value={form.bucket} onChange={(e) => set("bucket", e.target.value)} placeholder="home-inventory" /></Field></div><Field label="存储目录"><input required disabled={form.managedByEnvironment} className="input" value={form.directory} onChange={(e) => set("directory", e.target.value)} placeholder="home-inventory" /></Field><Field label="Endpoint（可选）"><input disabled={form.managedByEnvironment} className="input" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://oss-cn-hangzhou.aliyuncs.com" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="AccessKey ID"><input required disabled={form.managedByEnvironment} className="input" value={form.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} autoComplete="off" /></Field><Field label="AccessKey Secret"><input disabled={form.managedByEnvironment} className="input" type="password" value={form.accessKeySecret} onChange={(e) => set("accessKeySecret", e.target.value)} placeholder={form.accessKeySecretConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" /></Field></div><Field label="公开访问域名（可选）"><input disabled={form.managedByEnvironment} className="input" value={form.publicBaseUrl} onChange={(e) => set("publicBaseUrl", e.target.value)} placeholder="https://img.example.com" /></Field></>}<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--hairline)" }}><p className="m-0 text-xs leading-5 muted">图片支持 JPG、PNG、WebP、GIF，上传前自动压缩，最终大小限制 5MB。</p>{form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">{saving ? "保存中…" : "保存图片设置"}</button>}</div></form>}
  </SettingsSection>;
}

