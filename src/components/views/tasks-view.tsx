"use client";

import {
  CheckCircle2, Plus, Trash2, ListTodo, Repeat2,
} from "lucide-react";
import { FormEvent, useState } from "react";
import type { HouseholdTask, TaskRecurrence } from "@/types";
import {
  Badge, Button, Field,
} from "@/components/ui";
import { Empty, ListRow, Panel, Screen } from "@/components/ui-kit";
import { useConfirm } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { dateInputValue, taskDatePresets, request } from "../shared";
import { Modal } from "./modals";
export const recurrenceLabels: Record<TaskRecurrence, string> = { NONE: "一次性", DAILY: "每天", WEEKLY: "每周", MONTHLY: "每月", YEARLY: "每年" };
export function TasksView({ tasks, onAdd, onToggle, onDelete }: { tasks: HouseholdTask[]; onAdd: () => void; onToggle: (task: HouseholdTask) => void; onDelete: (task: HouseholdTask) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueSoon = tasks.filter((task) => new Date(task.dueAt).getTime() <= today.getTime() + 7 * 86400000);
  const summary = tasks.length ? `接下来 7 天有 ${dueSoon.length} 项任务` : "例如:每 3 个月清洁一次洗衣机";
  return (
    <Screen
      title="家庭任务"
      description="把清洁、保养和日常小事,安排成不会忘记的节奏。"
      actions={<Button variant="primary" onClick={onAdd} className="flex min-h-11 items-center gap-2"><Plus size={18} /><span className="desktop-only">安排任务</span></Button>}
    >
      <Panel
        title="任务清单"
        description={<span className="inline-flex items-center gap-1.5"><Repeat2 size={14} />{summary}</span>}
        actions={tasks.length ? <span className="shrink-0 text-xs font-bold muted">共 {tasks.length} 项</span> : undefined}
      >
        {tasks.length ? tasks.map((task) => {
          const due = new Date(task.dueAt);
          const overdue = due.getTime() < today.getTime();
          return (
            <ListRow
              key={task.id}
              icon={ListTodo}
              title={task.title}
              meta={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0">{overdue ? "已到期" : `到期 ${due.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`}</span>
                  <span className="shrink-0" aria-hidden="true">·</span>
                  <Badge tone={overdue ? "danger" : "neutral"}>{recurrenceLabels[task.recurrence]}</Badge>
                  {task.description && <><span className="shrink-0" aria-hidden="true">·</span><span className="min-w-0 truncate">{task.description}</span></>}
                </span>
              }
              trailing={
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => onToggle(task)} className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-2.5 text-xs font-bold sm:min-h-10 sm:min-w-0" aria-label={`完成任务:${task.title}`} title="标记为完成" style={{ color: overdue ? "var(--danger)" : "var(--primary)" }}>
                    <CheckCircle2 size={17} /><span className="hidden sm:inline">完成</span>
                  </Button>
                  <button onClick={() => onDelete(task)} className="icon-action min-h-11 min-w-11 sm:min-h-10 sm:min-w-10" aria-label="删除任务"><Trash2 size={15} /></button>
                </span>
              }
            />
          );
        }) : <Empty icon={ListTodo} title="还没有安排任务" text="从一次清洁或保养开始,让家务变得有节奏。" action={<button onClick={onAdd} className="btn-primary min-h-11 px-4">安排第一个任务</button>} />}
      </Panel>
    </Screen>
  );
}

export function TaskModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [dueAt, setDueAt] = useState(dateInputValue()); const [recurrence, setRecurrence] = useState<TaskRecurrence>("NONE"); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [initialDraft] = useState(() => ({ title: "", description: "", dueAt }));
  const dirty = title.trim() !== initialDraft.title || description.trim() !== initialDraft.description || dueAt !== initialDraft.dueAt;
  const askConfirm = useConfirm();
  const requestClose = async () => {
    if (!dirty || saving) { onClose(); return; }
    const confirmed = await askConfirm("已填写的内容会被丢弃,确定关闭吗?", { title: "放弃这次的任务?", confirmLabel: "放弃并关闭", cancelLabel: "继续填写" });
    if (confirmed) onClose();
  };
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!dueAt) { setError("请先选择下次日期"); return; } setSaving(true); try { await request("/api/tasks", { method: "POST", body: JSON.stringify({ title, description, dueAt, recurrence }) }); onSaved(); } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); } };
  return <Modal title="安排一个任务" subtitle="把容易忘记的小事,交给日历记着。" onClose={requestClose}><form onSubmit={submit} className="space-y-4"><Field label="任务名称"><input autoFocus required className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如:清洁洗衣机" /></Field><Field label="备注(可选)"><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如:清洁滤网和胶圈" /></Field><div className="grid grid-cols-2 gap-3"><Field label="下次日期" hint="到那天会出现在任务列表;可以选今天、明天或更远。"><DatePicker value={dueAt} onChange={setDueAt} label="下次日期" presets={taskDatePresets()} clearable={false} /></Field><Field label="重复周期"><select className="input" value={recurrence} onChange={(event) => setRecurrence(event.target.value as TaskRecurrence)}>{Object.entries(recurrenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>{error && <p className="m-0 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost min-h-11 flex-1">取消</button><button disabled={saving} className="btn-primary min-h-11 flex-1">{saving ? "保存中..." : "安排任务"}</button></div></form></Modal>;
}
