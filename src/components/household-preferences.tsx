"use client";

import { BellRing, CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";

type Preferences = { expiryReminderDays: number; lowStockReminder: boolean; weeklyReviewEnabled: boolean; weeklyReviewDay: number };

export function HouseholdPreferences({ onToast }: { onToast: (message: string) => void }) {
  const [value, setValue] = useState<Preferences>({ expiryReminderDays: 7, lowStockReminder: true, weeklyReviewEnabled: true, weeklyReviewDay: 0 });
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/settings/preferences").then((response) => response.ok ? response.json() : null).then((result) => result && setValue(result)).catch(() => undefined); }, []);
  const update = async (patch: Partial<Preferences>) => {
    const next = { ...value, ...patch }; setValue(next); setSaving(true);
    try { const response = await fetch("/api/settings/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); if (!response.ok) throw new Error("保存失败"); onToast("提醒偏好已保存"); } catch (error) { onToast(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); }
  };
  return <section className="surface rounded-3xl p-5"><div className="flex items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><BellRing size={20} /></div><div className="min-w-0 flex-1"><h3 className="m-0 text-sm font-black">提醒与盘点</h3><p className="mb-0 mt-1 text-xs muted">只提醒真正需要处理的事情，{saving ? "正在保存…" : "设置会自动保存"}</p></div></div><div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}><label className="flex items-center justify-between gap-3 text-sm"><span>临期提前提醒</span><select className="input w-auto min-w-24 py-2" value={value.expiryReminderDays} onChange={(event) => void update({ expiryReminderDays: Number(event.target.value) })}><option value={3}>3 天</option><option value={7}>7 天</option><option value={14}>14 天</option><option value={30}>30 天</option></select></label><label className="flex items-center justify-between gap-3 text-sm"><span>低库存提醒</span><input type="checkbox" checked={value.lowStockReminder} onChange={(event) => void update({ lowStockReminder: event.target.checked })} /></label><label className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><CalendarClock size={15} className="muted" />每周盘点提醒</span><input type="checkbox" checked={value.weeklyReviewEnabled} onChange={(event) => void update({ weeklyReviewEnabled: event.target.checked })} /></label>{value.weeklyReviewEnabled && <label className="flex items-center justify-between gap-3 text-sm"><span>提醒日</span><select className="input w-auto min-w-24 py-2" value={value.weeklyReviewDay} onChange={(event) => void update({ weeklyReviewDay: Number(event.target.value) })}><option value={0}>周日</option><option value={1}>周一</option><option value={2}>周二</option><option value={3}>周三</option><option value={4}>周四</option><option value={5}>周五</option><option value={6}>周六</option></select></label>}</div></section>;
}
