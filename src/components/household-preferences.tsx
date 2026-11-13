"use client";

import { BellRing, CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsBadge, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@/components/settings-primitives";

type Preferences = { expiryReminderDays: number; lowStockReminder: boolean; weeklyReviewEnabled: boolean; weeklyReviewDay: number };

// 下拉选项统一走 SettingsSelect 的 [值, 文案] 形式;值保持字符串,提交前再转回数字,
// 这样接口 payload(expiryReminderDays / weeklyReviewDay 仍是 number)与改造前完全一致。
const EXPIRY_OPTIONS = [["3", "3 天"], ["7", "7 天"], ["14", "14 天"], ["30", "30 天"]] as const;
const WEEKDAY_OPTIONS = [["0", "周日"], ["1", "周一"], ["2", "周二"], ["3", "周三"], ["4", "周四"], ["5", "周五"], ["6", "周六"]] as const;
const WEEKDAY_LABELS: Record<number, string> = { 0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六" };

export function HouseholdPreferences({ onToast }: { onToast: (message: string) => void }) {
  const [value, setValue] = useState<Preferences>({ expiryReminderDays: 7, lowStockReminder: true, weeklyReviewEnabled: true, weeklyReviewDay: 0 });
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/settings/preferences").then((response) => response.ok ? response.json() : null).then((result) => result && setValue(result)).catch(() => undefined); }, []);
  const update = async (patch: Partial<Preferences>) => {
    const next = { ...value, ...patch }; setValue(next); setSaving(true);
    try { const response = await fetch("/api/settings/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); if (!response.ok) throw new Error("保存失败"); onToast("提醒偏好已保存"); } catch (error) { onToast(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); }
  };

  // 折叠状态下也能读懂:三件事的真实状态都进 summary,保存状态进 badge。
  const weekly = value.weeklyReviewEnabled ? `每周盘点 ${WEEKDAY_LABELS[value.weeklyReviewDay] ?? "开"}` : "每周盘点 关";
  const summary = `低库存提醒 ${value.lowStockReminder ? "开" : "关"} · 保质期提前 ${value.expiryReminderDays} 天 · ${weekly}`;

  return <SettingsSection
    icon={BellRing}
    title="提醒与盘点"
    summary={summary}
    badge={<SettingsBadge tone={saving ? "warning" : "muted"}>{saving ? "保存中..." : "自动保存"}</SettingsBadge>}
  >
    <SettingsRow
      title="临期提前提醒"
      control={<SettingsSelect
        ariaLabel="临期提前提醒"
        value={String(value.expiryReminderDays)}
        onChange={(next) => void update({ expiryReminderDays: Number(next) })}
        options={EXPIRY_OPTIONS}
      />}
    />
    <SettingsRow
      title="低库存提醒"
      onActivate={() => void update({ lowStockReminder: !value.lowStockReminder })}
      control={<SettingsSwitch
        label="低库存提醒"
        checked={value.lowStockReminder}
        onChange={(next) => void update({ lowStockReminder: next })}
      />}
    />
    <SettingsRow
      icon={CalendarClock}
      title="每周盘点提醒"
      onActivate={() => void update({ weeklyReviewEnabled: !value.weeklyReviewEnabled })}
      control={<SettingsSwitch
        label="每周盘点提醒"
        checked={value.weeklyReviewEnabled}
        onChange={(next) => void update({ weeklyReviewEnabled: next })}
      />}
    />
    {value.weeklyReviewEnabled && <SettingsRow
      title="提醒日"
      control={<SettingsSelect
        ariaLabel="每周盘点提醒日"
        value={String(value.weeklyReviewDay)}
        onChange={(next) => void update({ weeklyReviewDay: Number(next) })}
        options={WEEKDAY_OPTIONS}
      />}
    />}
  </SettingsSection>;
}
