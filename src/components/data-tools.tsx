"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from "react";
import { MAX_BACKUP_BYTES, backupTooLargeMessage } from "@/lib/backup-limits";
import { backupFileOptionLabel, backupFileSourceFingerprint } from "@/lib/backup-label";
import { DatabaseBackup, X, Download, Upload, Users, UserPlus, History, ShieldCheck } from "lucide-react";
import { ScanActivityPanel } from "@/components/scan-activity-panel";
import { activityLabel } from "@/lib/activity-label";
import { csvToItems, importResultText } from "@/lib/csv-import";
import { SettingsBadge, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings-primitives";
import { ListRow } from "@/components/ui-kit";
import { useConfirm } from "@/components/confirm-dialog";

export function DataTools({ role, onToast }: { role: "ADMIN" | "MEMBER" | "VIEWER" | null; onToast: (message: string) => void }) {
  const askConfirm = useConfirm();
  const [members, setMembers] = useState<{ id: string; name: string; color: string }[]>([]);
  const [name, setName] = useState("");
  const [activity, setActivity] = useState<{ id: string; action: string; itemName: string | null; createdAt: string }[]>([]);
  // 接口一次最多给 100 条;这个数是**真实总数**(来自 X-Total-Count),用来把「截断」说清楚。
  const [activityTotal, setActivityTotal] = useState<number | null>(null);
  // 从服务器上那份备份恢复用的选择项(见 restoreFromServerFile)。
  const [serverFile, setServerFile] = useState("");
  // 自动备份状态:界面上要能看出它有没有在跑(此前完全没有显示)。
  // `database` 是**本库指纹**:文件名里的 6 位十六进制就是它,界面据此把「本机 / 另一份库」标清楚。
  const [autoBackup, setAutoBackup] = useState<{ lastAutoBackupAt: string | null; keep: number; files: number; fileNames?: string[]; database?: string | null; fileOrigins?: Record<string, string | null>; stale: boolean } | null>(null);
  const load = () => { fetch("/api/members").then((r) => r.json()).then(setMembers).catch(() => undefined);
    if (role === "ADMIN") fetch("/api/backup/auto").then((r) => (r.ok ? r.json() : null)).then((data) => data && setAutoBackup(data)).catch(() => undefined); fetch("/api/activity").then((r) => {
  const header = r.headers.get("x-total-count");
  if (header && /^\d+$/.test(header)) setActivityTotal(Number(header));
  return r.json();
}).then(setActivity).catch(() => undefined); };
  useEffect(load, []);

  // 自动备份状态单独拉:渲染期不能调 Date.now()(react-hooks/purity),所以在这里算好「是否过期」。
  useEffect(() => {
    if (role !== "ADMIN") return;
    fetch("/api/backup/auto")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        const last = data.lastAutoBackupAt ? new Date(data.lastAutoBackupAt).getTime() : null;
        setAutoBackup({ ...data, stale: last === null || Date.now() - last > 2 * 86400000 });
      })
      .catch(() => undefined);
  }, [role]);
  // 从服务器上那份自动备份恢复:备份超过请求上限时,上传这条路根本走不通 ——
  // 服务器本来就每天写一份到磁盘,直接让它自己读。
  const restoreFromServerFile = async (fileName: string) => {
    if (!fileName) return;
    if (!(await askConfirm(`将把服务器上的 ${fileName} 合并恢复到当前家庭(重复数据会自动跳过)。`, { title: "从服务器备份恢复", confirmLabel: "开始恢复" }))) return;
    try {
      const response = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromFile: fileName }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "恢复失败");
      onToast(`已从 ${result.sourceFile ?? fileName} 恢复 ${result.items} 件物品、${result.locations} 个空间`);
      load();
    } catch (error) { onToast(error instanceof Error ? error.message : "恢复失败"); }
  };
  const addMember = async () => { if (!name.trim()) return; const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (response.ok) { setName(""); load(); onToast("成员已添加"); } };
  const importFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const isCsv = /\.csv$/i.test(file.name) || (!text.trimStart().startsWith("[") && !text.trimStart().startsWith("{") && text.includes(","));
    let payload: unknown = null;
    let issues: { row: number; error: string }[] = [];
    if (isCsv) {
      // CSV 走本地解析:表头与「导出当前筛选为 CSV」一致,导出的表格改完可以再导回来。
      const parsed = csvToItems(text);
      if (!parsed.items.length && parsed.issues.length) { onToast(parsed.issues[0].error); return; }
      payload = parsed.items;
      issues = parsed.issues;
    } else {
      try { payload = JSON.parse(text); } catch { onToast("这个文件既不是有效的物品 JSON,也不是 CSV"); return; }
    }
    try {
      const response = await fetch("/api/items/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      // 整批都不合法时,原因就在 result.errors 里 —— 这里以前直接 throw「导入失败」,
      // 把「第 2 行:备注最多 500 个字」这种能照着改的信息整个丢掉了,用户只看到「失败了」。
      // 只有接口连逐行原因都没给时,才退回它给的 error / 通用文案。
      const rowErrors = Array.isArray(result?.errors) ? result.errors : null;
      if (!response.ok && !result?.count && !rowErrors?.length) throw new Error(result?.error || "导入失败");
      onToast(importResultText(Number(result?.count ?? 0), result?.errors, issues, Array.isArray(result?.createdLocations) ? result.createdLocations : []));
    } catch (error) { onToast(error instanceof Error ? error.message : "导入失败"); }
  };
  // 成员写错了名字要能改:此前只能加、不能删,写错就永远留着。
  // 只做删除 —— 改名用「删掉重建」即可,不必为此引入 PATCH。
  const removeMember = async (member: { id: string; name: string }) => {
    try {
      const response = await fetch(`/api/members/${member.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "删除失败");
      }
      load();
      onToast(`已移除成员「${member.name}」`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "删除失败");
    }
  };

  const restoreBackup = async (file?: File) => { if (!file) return;
  // 先比大小:超限的话服务端会以「请求内容不是合法的 JSON」拒绝,那句话会把人带偏。
  if (file.size > MAX_BACKUP_BYTES) { onToast(backupTooLargeMessage(file.size)); return; }
  try { let backup; try { backup = JSON.parse(await file.text()); } catch { onToast("这个文件不是有效的完整备份 JSON,请选择「导出完整备份」生成的文件"); return; } const counts = { items: Array.isArray(backup.items) ? backup.items.length : 0, locations: Array.isArray(backup.locations) ? backup.locations.length : 0, shopping: Array.isArray(backup.shopping) ? backup.shopping.length : 0, priceRecords: Array.isArray(backup.priceRecords) ? backup.priceRecords.length : 0, members: Array.isArray(backup.members) ? backup.members.length : 0 }; if (!counts.items && !counts.locations && !counts.shopping) throw new Error("备份文件中没有可恢复的数据"); const summary = `将检查 ${counts.items} 件物品、${counts.locations} 个空间、${counts.shopping} 条采购${counts.priceRecords ? `、${counts.priceRecords} 条价格记录` : ""}${counts.members ? `、${counts.members} 位成员` : ""}，重复数据会自动跳过;格式不认识的行也会被跳过,恢复完会告诉你跳了哪些。`; if (!(await askConfirm(summary, { title: "恢复完整备份", confirmLabel: "开始恢复" }))) return; const response = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backup) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "恢复失败"); const skippedTotal = Number(result.skipped?.total ?? 0);
  const duplicatedTotal = Number(result.duplicated?.total ?? 0); const firstSkip = Array.isArray(result.skipped?.examples) ? result.skipped.examples[0] : null; const base = `已合并恢复 ${result.items} 件物品、${result.locations} 个空间、${result.priceRecords || 0} 条价格记录`;
  // 超过单次上限而没恢复的部分必须说出来:静默少恢复,用户会以为「备份就是这些」。
  const truncatedTotal = Number(result.truncatedTotal ?? 0);
  const TRUNCATED_LABELS: Record<string, string> = { locations: "空间", items: "物品", shopping: "采购", priceRecords: "价格记录", members: "成员", tasks: "任务", audits: "盘点", activities: "活动记录", preferences: "偏好设置" };
  const truncatedText = Object.entries(result.truncated ?? {}).map(([key, value]) => `${TRUNCATED_LABELS[key] ?? key} ${value}`).join("、");
  const notes = [
    duplicatedTotal > 0 ? `${duplicatedTotal} 条与库里已有的重复,已跳过` : "",
    skippedTotal > 0 ? `${skippedTotal} 行格式不认识,没进${firstSkip ? `(第 ${firstSkip.row} 行:${firstSkip.reason})` : ""}` : "",
    truncatedTotal > 0 ? `另有 ${truncatedTotal} 条超过单次恢复上限,没有恢复(${truncatedText});请分两次导入或改用重新部署` : "",
  ].filter(Boolean);
  onToast(notes.length ? `${base};${notes.join(";")}` : base); } catch (error) { onToast(error instanceof Error ? error.message : "恢复失败"); } };

  // 完整备份与恢复备份是管理员专属(接口对成员返回 403),别把按钮摆在成员面前
  const isAdmin = role === "ADMIN";
  // 只读账号能看能导出,但不能写(导入/加成员都会被 403 拒绝)
  const isViewer = role === "VIEWER";

  // 超过两天没成功备份就提示 —— 这类「静静没在跑」的事必须让人看见(state.stale 在请求回调里算)。
  const autoBackupStale = Boolean(autoBackup?.stale);

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
      control={<div className="flex w-full flex-wrap gap-2 sm:justify-end">{/* 备份动作按「按钮组右对齐」统一 */}
        {isAdmin && <a className="btn-primary flex items-center gap-2 text-xs" href="/api/backup"><Download size={14} />导出完整备份</a>}
        <a className="btn-ghost flex items-center gap-2 text-xs" href="/api/items?export=1"><Download size={14} />导出物品 JSON</a>
        <a href="/report" target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-2 text-xs" aria-label="打开家庭月报">
          <History size={14} />家庭月报
        </a>
{!isViewer && <label className="file-label btn-ghost flex cursor-pointer items-center gap-2 text-xs"><Upload size={14} />导入物品<input type="file" accept="application/json,.json,text/csv,.csv" className="sr-only" onChange={(e) => importFile(e.target.files?.[0])} /></label>}
        {isAdmin && <label className="file-label btn-ghost flex cursor-pointer items-center gap-2 text-xs"><History size={14} />合并恢复备份<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => restoreBackup(e.target.files?.[0])} /></label>}
      </div>}
    />

    <SettingsRow
      icon={Users}
      title="家庭成员"
      // 这一份成员是「给物品标注归属的人」,和能登录的账号不是一回事 —— 不写清就会和
      // 上面「账号与家庭成员」里的账号数对不上(实测同页出现「4 个登录账号」与「0 位成员」)。
      description="成员用来标注物品归属(谁的药、谁的毛巾),不需要账号;能登录的账号在上面的「账号与家庭成员」里管。"
      stacked
      control={<div className="flex w-full flex-wrap items-center gap-2">
        {members.length === 0 && <span className="text-xs muted">还没有家庭成员。加上之后,录入物品时就能标注这是谁的。</span>}
        {members.map((member) => <span key={member.id} className="rounded-xl px-2.5 py-1.5 text-xs font-bold" style={{
            background: "var(--surface-soft)",
            // 成员颜色是固定值(默认 #7c3aed),直接当文字色时,深色背景下对比度只有 2.4 左右。
            // 这里按主题把成员色向「前景色」混一档:浅色主题下变深、深色主题下变亮,两种主题都能达标。
            "--member-ink": member.color,
            color: "color-mix(in srgb, var(--member-ink) 68%, var(--foreground))",
          } as React.CSSProperties}>
            {member.name}
            {/* 成员写错名字要能改:此前只能加、不能删,写错就永远留着(只对有写权限的人显示) */}
            {!isViewer && (
              <button
                type="button"
                onClick={() => void removeMember(member)}
                aria-label={`移除成员「${member.name}」`}
                title="移除这个成员"
                className="ml-1 inline-grid size-5 place-items-center rounded-full align-middle"
              >
                <X size={12} />
              </button>
            )}
          </span>)}
        {!isViewer && <div className="ml-auto flex gap-2">
          <input className="input h-11 min-h-11 w-28 py-1 text-xs" aria-label="成员名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="成员名称" />
          <button type="button" onClick={addMember} aria-label="添加成员" title="添加成员" className="btn-ghost grid size-11 min-h-11 place-items-center p-0"><UserPlus size={14} /></button>
        </div>}
      </div>}
    />

      <SettingsRow
        icon={DatabaseBackup}
        title="自动备份状态"
        description="每天首次打开时自动备份一次;超过保留份数的旧备份会被清理"
        control={<SettingsBadge tone={autoBackupStale ? "warning" : "muted"}>{autoBackupStale ? "可能没在跑" : `保留最近 ${autoBackup?.keep ?? "?"} 份`}</SettingsBadge>}
      />
      <p className="mb-0 px-1 pb-2 text-xs muted">
        {autoBackup === null
          ? "正在读取自动备份状态…"
          : autoBackup.lastAutoBackupAt
            ? `上次成功:${new Date(autoBackup.lastAutoBackupAt).toLocaleString("zh-CN")};目录里现有 ${autoBackup.files} 份。`
            : "还没有成功执行过。请确认服务端 data/backups 目录可写。"}
        {autoBackupStale ? " 已经超过两天没有成功备份,点上面的「导出完整备份」先手动存一份。" : ""}
      </p>
      {/* 备份超过上传上限(64 MB)时,「合并恢复备份」那条路走不通 ——
          服务器本来就每天写一份到磁盘,直接让它自己读那份文件即可。 */}
      {isAdmin && (autoBackup?.fileNames?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs muted">从服务器上的备份恢复:</span>
          {/* 用共享的 SettingsSelect(设置页有一条约定检查:下拉必须来自它),
              控件高度也必须是 40px(可达性检查)。
              选项文字走 backupFileOptionLabel:只列文件名的话,同一台机器上另一份库的备份
              看起来只是个随机后缀(实测家庭库那份被探针库顶掉过,当时看不出是谁写的)。 */}
          <SettingsSelect
            ariaLabel="从服务器上的备份恢复"
            value={serverFile || (autoBackup?.fileNames?.at(-1) ?? "")}
            onChange={(value) => setServerFile(value)}
            options={(autoBackup?.fileNames ?? []).map((name) => [
              name,
              backupFileOptionLabel(name, backupFileSourceFingerprint(name, autoBackup?.fileOrigins), autoBackup?.database ?? ""),
            ] as const)}
            className="min-h-10"
          />
          <button type="button" className="btn-ghost h-10 min-h-10 px-3 text-xs" onClick={() => restoreFromServerFile(serverFile || autoBackup?.fileNames?.at(-1) || "")}>恢复这一份</button>
        </div>
      )}
      {isAdmin && (autoBackup?.fileNames?.length ?? 0) > 0 && (
        <p className="mb-0 px-1 pb-3 text-xs muted">
          文件名末尾那 6 位十六进制,是<strong>写这份备份的那个库</strong>的指纹:同一台机器上跑的别的实例会把自己的那份另存成带指纹的名字,不会覆盖本机的备份。升级前写的老备份没有这一段,标为「未标明来源」。
        </p>
      )}

          <SettingsRow
      icon={History}
      
      title={activityTotal !== null && activityTotal > 5 ? `最近操作(共 ${activityTotal} 条,只列最近 5 条)` : "最近操作"}
      stacked
      control={<div className="w-full">{activity.slice(0, 5).map((entry) => <ListRow key={entry.id} title={<span className="block whitespace-normal break-words">{activityLabel(entry.action)} · {entry.itemName || "物品"}</span>} trailing={<span className="shrink-0 text-xs muted">{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</span>} />)}</div>}
    />

    <ScanActivityPanel onToast={onToast} />
  </SettingsSection>;
}
