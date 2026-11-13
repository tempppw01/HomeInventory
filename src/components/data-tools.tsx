"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from "react";
import { Download, Upload, Users, UserPlus, History, ShieldCheck } from "lucide-react";
import { ScanActivityPanel } from "@/components/scan-activity-panel";
import { SettingsBadge, SettingsRow, SettingsSection } from "@/components/settings-primitives";
import { useConfirm } from "@/components/confirm-dialog";

export function DataTools({ onToast }: { onToast: (message: string) => void }) {
  const askConfirm = useConfirm();
  const [members, setMembers] = useState<{ id: string; name: string; color: string }[]>([]);
  const [name, setName] = useState("");
  const [activity, setActivity] = useState<{ id: string; action: string; itemName: string | null; createdAt: string }[]>([]);
  const load = () => { fetch("/api/members").then((r) => r.json()).then(setMembers).catch(() => undefined); fetch("/api/activity").then((r) => r.json()).then(setActivity).catch(() => undefined); };
  useEffect(load, []);
  const addMember = async () => { if (!name.trim()) return; const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (response.ok) { setName(""); load(); onToast("成员已添加"); } };
  const importFile = async (file?: File) => { if (!file) return; try { let rows; try { rows = JSON.parse(await file.text()); } catch { onToast("这个文件不是有效的物品 JSON,请选择「导出物品 JSON」生成的文件"); return; } const response = await fetch("/api/items/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); onToast(`已导入 ${result.count} 件物品`); } catch (error) { onToast(error instanceof Error ? error.message : "导入失败"); } };
  const restoreBackup = async (file?: File) => { if (!file) return; try { let backup; try { backup = JSON.parse(await file.text()); } catch { onToast("这个文件不是有效的完整备份 JSON,请选择「导出完整备份」生成的文件"); return; } const counts = { items: Array.isArray(backup.items) ? backup.items.length : 0, locations: Array.isArray(backup.locations) ? backup.locations.length : 0, shopping: Array.isArray(backup.shopping) ? backup.shopping.length : 0, priceRecords: Array.isArray(backup.priceRecords) ? backup.priceRecords.length : 0, members: Array.isArray(backup.members) ? backup.members.length : 0 }; if (!counts.items && !counts.locations && !counts.shopping) throw new Error("备份文件中没有可恢复的数据"); const summary = `将检查 ${counts.items} 件物品、${counts.locations} 个空间、${counts.shopping} 条采购${counts.priceRecords ? `、${counts.priceRecords} 条价格记录` : ""}${counts.members ? `、${counts.members} 位成员` : ""}，重复数据会自动跳过。继续吗？`; if (!(await askConfirm(summary, { title: "恢复完整备份", confirmLabel: "开始恢复" }))) return; const response = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backup) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "恢复失败"); onToast(`已合并恢复 ${result.items} 件物品、${result.locations} 个空间、${result.priceRecords || 0} 条价格记录`); } catch (error) { onToast(error instanceof Error ? error.message : "恢复失败"); } };

  return <SettingsSection
    icon={ShieldCheck}
    title="数据安全与家庭成员"
    summary="导出 JSON / 完整备份 · 导入校验 · 自动备份"
    badge={<SettingsBadge tone={members.length > 0 ? "primary" : "muted"}>{members.length} 位成员</SettingsBadge>}
  >
    <SettingsRow
      icon={Download}
      title="备份与迁移"
      description="完整备份不包含登录密码和 API 密钥；恢复只添加缺失数据，不会清空当前家庭记录。"
      stacked
      control={<div className="flex w-full flex-wrap gap-2">
        <a className="btn-primary flex items-center gap-2 text-xs" href="/api/backup"><Download size={14} />导出完整备份</a>
        <a className="btn-ghost flex items-center gap-2 text-xs" href="/api/items?export=1"><Download size={14} />导出物品 JSON</a>
        <label className="btn-ghost flex cursor-pointer items-center gap-2 text-xs"><Upload size={14} />导入物品<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} /></label>
        <label className="btn-ghost flex cursor-pointer items-center gap-2 text-xs"><History size={14} />合并恢复备份<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => restoreBackup(e.target.files?.[0])} /></label>
      </div>}
    />

    <SettingsRow
      icon={Users}
      title="家庭成员"
      stacked
      control={<div className="flex w-full flex-wrap items-center gap-2">
        {members.map((member) => <span key={member.id} className="rounded-xl px-2.5 py-1.5 text-xs font-bold" style={{ background: "var(--surface-soft)", color: member.color }}>{member.name}</span>)}
        <div className="flex gap-2">
          <input className="input h-11 min-h-11 w-28 py-1 text-xs" aria-label="成员名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="成员名称" />
          <button type="button" onClick={addMember} aria-label="添加成员" title="添加成员" className="btn-ghost grid size-11 min-h-11 place-items-center p-0"><UserPlus size={14} /></button>
        </div>
      </div>}
    />

    <SettingsRow
      icon={History}
      title="最近操作"
      stacked
      control={<div className="w-full">{activity.slice(0, 5).map((entry) => <div key={entry.id} className="flex justify-between gap-3 py-1 text-xs muted"><span className="min-w-0 truncate">{entry.action} · {entry.itemName || "物品"}</span><span className="shrink-0">{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</span></div>)}</div>}
    />

    <ScanActivityPanel onToast={onToast} />
  </SettingsSection>;
}
