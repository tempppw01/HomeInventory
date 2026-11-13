"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ClipboardCopy, Eye, EyeOff, History, KeyRound, Loader2, LogOut, MonitorX, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { generatePassword, PASSWORD_MIN_LENGTH } from "@/lib/password";
import { SettingsActions, SettingsBadge, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings-primitives";
import { useConfirm } from "@/components/confirm-dialog";

type User = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  active: boolean;
  lastLogin: { ipAddress: string | null; device: string; createdAt: string } | null;
  sessions: { id: string; device: string; ipAddress: string | null; createdAt: string; expiresAt: string; isCurrent: boolean }[];
};

type LoginRecord = {
  id: string;
  username: string;
  displayName: string;
  ipAddress: string | null;
  device: string;
  success: boolean;
  failureReason: string | null;
  createdAt: string;
};

const roleLabel = (role: User["role"]) => role === "ADMIN" ? "管理员" : role === "VIEWER" ? "只读" : "成员";

const ROLE_OPTIONS = [["ADMIN", "管理员"], ["MEMBER", "成员"], ["VIEWER", "只读"]] as const;

function formatLoginTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** 一次性凭据:账号创建、密码重置、恢复码生成都复用这块面板。 */
type Credentials = { title: string; hint: string; username?: string; password?: string; passwordLabel?: string; recoveryCode?: string | null };

function CredentialRow({ label, value, mono, onCopy }: { label: string; value: string; mono?: boolean; onCopy: (value: string, message: string) => void }) {
  return <SettingsRow
    title={label}
    description={<code className={`block break-all text-sm ${mono ? "tracking-[0.12em]" : ""}`}>{value}</code>}
    control={<button type="button" onClick={() => onCopy(value, `${label}已复制`)} className="icon-action size-11 min-h-11 shrink-0" aria-label={`复制${label}`} title={`复制${label}`}><ClipboardCopy size={15} /></button>}
  />;
}

function CredentialsCard({ title, hint, username, password, passwordLabel = "初始密码", recoveryCode, onCopy, onClose }: Credentials & { onCopy: (value: string, message: string) => void; onClose: () => void }) {
  const all = [username ? `用户名:${username}` : "", password ? `密码:${password}` : "", recoveryCode ? `恢复码:${recoveryCode}` : ""].filter(Boolean).join("\n");
  const allMessage = username || password ? "登录信息已复制" : "恢复码已复制";
  // 一次性凭据是「看完就关」的强调块:保留品牌色描边,内部的行与按钮统一走设置原语。
  return <section className="mt-3 rounded-2xl border p-4" style={{ borderColor: "var(--brand-accent)", background: "color-mix(in srgb, var(--brand-accent) 8%, transparent)" }}>
    <SettingsRow
      icon={Check}
      title={title}
      description={hint}
      control={<button type="button" onClick={onClose} className="icon-action size-11 min-h-11 shrink-0" aria-label="关闭凭据提示" title="关闭"><X size={16} /></button>}
    />
    {username && <CredentialRow label="用户名" value={username} onCopy={onCopy} />}
    {password && <CredentialRow label={passwordLabel} value={password} onCopy={onCopy} />}
    {recoveryCode && <CredentialRow label="恢复码" value={recoveryCode} mono onCopy={onCopy} />}
    {all && <SettingsActions>
      <button type="button" onClick={() => onCopy(all, allMessage)} className="btn-ghost flex min-h-11 items-center justify-center gap-1.5 text-xs"><ClipboardCopy size={14} />复制全部</button>
    </SettingsActions>}
  </section>;
}

export function AccountSettings({ onToast }: { onToast: (message: string) => void }) {
  const askConfirm = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [loginRecords, setLoginRecords] = useState<LoginRecord[]>([]);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "MEMBER" });
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [created, setCreated] = useState<Credentials | null>(null);
  const [resetCredential, setResetCredential] = useState<Credentials | null>(null);
  const [creating, setCreating] = useState(false);
  // 「密码与恢复码」面向所有已登录账号,与下面的管理员面板互不影响。
  const [recovery, setRecovery] = useState<{ loading: boolean; hasCode: boolean; generatedAt: string | null }>({ loading: true, hasCode: false, generatedAt: null });
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [usersResponse, recordsResponse] = await Promise.all([fetch("/api/auth/users"), fetch("/api/auth/login-records")]);
    if (usersResponse.ok) setUsers(await usersResponse.json());
    if (recordsResponse.ok) setLoginRecords(await recordsResponse.json());
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load().catch(() => undefined); });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const loadRecoveryStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/recovery");
      if (!response.ok) { setRecovery((current) => ({ ...current, loading: false })); return; }
      const result = await response.json() as { hasCode?: boolean; generatedAt?: string | null };
      setRecovery({ loading: false, hasCode: Boolean(result.hasCode), generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : null });
    } catch { setRecovery((current) => ({ ...current, loading: false })); }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void loadRecoveryStatus(); });
    return () => cancelAnimationFrame(frame);
  }, [loadRecoveryStatus]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    const response = await fetch("/api/auth/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "创建失败"); setCreating(false); return; }
    // Keep the generated password + recovery code visible so the admin can pass them to the new member.
    setCreated({ title: `账号已创建,请把登录信息交给 ${form.displayName}`, hint: "复制下面的用户名、初始密码和恢复码当面发给家人;密码和恢复码只在这里显示这一次。", username: form.username, password: form.password, recoveryCode: typeof result.recoveryCode === "string" ? result.recoveryCode : null });
    setForm({ username: "", displayName: "", password: "", role: "MEMBER" });
    setShowFormPassword(false);
    await load();
    onToast("账号已创建");
    setCreating(false);
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < PASSWORD_MIN_LENGTH) {
      setResetError(`密码至少需要 ${PASSWORD_MIN_LENGTH} 位`);
      return;
    }
    setResetError("");
    setResetting(true);
    const response = await fetch(`/api/auth/users/${resetTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: resetPassword }) });
    const result = await response.json().catch(() => ({}));
    setResetting(false);
    if (!response.ok) { setResetError(result.error || "重置失败"); return; }
    // 服务端重置密码时会同时轮换恢复码,一并展示(旧服务端没有该字段时只是不显示)。
    setResetCredential({
      title: `已重置“${resetTarget.displayName}”的密码`,
      hint: "请把新密码和恢复码当面交给家人;旧密码已失效,恢复码只显示这一次。",
      username: resetTarget.username,
      password: resetPassword,
      passwordLabel: "新密码",
      recoveryCode: typeof result.recoveryCode === "string" ? result.recoveryCode : null,
    });
    setResetTarget(null);
    setResetPassword("");
    setShowResetPassword(false);
    await load();
    onToast(`已重置“${resetTarget.displayName}”的密码`);
  };

  const mintRecoveryCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!recoveryPassword) { setRecoveryError("请输入当前密码"); return; }
    setRecoveryError("");
    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/auth/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: recoveryPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setRecoveryError(result.error || "生成失败,请稍后重试"); return; }
      setRecoveryCode(typeof result.code === "string" ? result.code : null);
      setRecoveryPassword("");
      setShowRecoveryPassword(false);
      setRecoveryOpen(false);
      await loadRecoveryStatus();
      onToast("恢复码已生成,请立刻保存");
    } catch {
      setRecoveryError("网络异常,请稍后重试");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onToast(message);
    } catch {
      onToast("复制失败,请手动选择文本复制");
    }
  };

  const updateUser = async (user: User, patch: Record<string, unknown>) => {
    const response = await fetch(`/api/auth/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "更新失败"); return; }
    await load();
    onToast("账号已更新");
  };

  const removeUser = async (user: User) => {
    if (!(await askConfirm(`确定删除账号“${user.displayName}”?该账号的登录状态会立即失效。`, { title: "删除账号", confirmLabel: "删除账号", tone: "danger" }))) return;
    const response = await fetch(`/api/auth/users/${user.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "删除失败"); return; }
    await load();
    onToast("账号已删除");
  };

  const revokeSession = async (user: User, session: User["sessions"][number]) => {
    if (!(await askConfirm(`“${user.displayName}”在 ${session.device} 上的登录会被踢出,该设备需要重新登录。`, { title: "踢出此设备", confirmLabel: "踢出设备", tone: "danger" }))) return;
    const response = await fetch(`/api/auth/sessions/${session.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "踢出设备失败"); return; }
    await load();
    onToast("该设备已退出登录");
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); location.reload(); };

  // 折叠状态摘要 / 徽标:只用真实数据,不展开也能读懂。
  const currentUser = users.find((user) => user.sessions.some((session) => session.isCurrent));
  const inactiveUsers = users.filter((user) => !user.active).length;
  const accountSummary = users.length === 0
    ? "正在读取账号..."
    : currentUser
      ? `当前账号 ${currentUser.displayName} · ${roleLabel(currentUser.role)} · ${users.length} 位家庭成员`
      : `${users.length} 位家庭成员`;
  const accountBadge = users.length === 0
    ? <SettingsBadge tone="muted">读取中</SettingsBadge>
    : <SettingsBadge tone={inactiveUsers > 0 ? "warning" : "success"}>{inactiveUsers > 0 ? `${inactiveUsers} 个已停用` : "全部启用"}</SettingsBadge>;
  const recoverySummary = recovery.loading
    ? "正在读取恢复码状态..."
    : recovery.hasCode
      ? `已设置恢复码${recovery.generatedAt ? ` · 生成于 ${formatLoginTime(recovery.generatedAt)}` : ""}`
      : "尚未设置恢复码";

  return <>
  <SettingsSection icon={Users} title="账号与家庭成员" summary={accountSummary} badge={accountBadge}>
    {users.map((user) => <div key={user.id}>
      <SettingsRow
        stacked
        title={<span className="block truncate">{user.displayName}</span>}
        description={<>
          @{user.username} · 权限:{roleLabel(user.role)} · {user.active ? "正常" : "已停用"}{user.sessions.length > 0 ? ` · 已登录设备 ${user.sessions.length}` : ""}
          {user.lastLogin && <span className="block">最近登录:{user.lastLogin.ipAddress || "未知 IP"} · {user.lastLogin.device} · {formatLoginTime(user.lastLogin.createdAt)}</span>}
        </>}
        control={<div className="flex w-full flex-wrap items-center gap-2">
          <SettingsSelect
            ariaLabel={`${user.displayName}的账号权限`}
            value={user.role}
            onChange={(next) => void updateUser(user, { role: next })}
            options={ROLE_OPTIONS}
          />
          <button onClick={() => void updateUser(user, { active: !user.active })} className="btn-ghost px-2.5 py-1.5 text-xs">{user.active ? "停用" : "启用"}</button>
          <button onClick={() => { setResetTarget(user); setResetPassword(""); setResetError(""); }} className="btn-ghost px-2.5 py-1.5 text-xs">重置密码</button>
          <button onClick={() => void removeUser(user)} className="btn-ghost px-2.5 py-1.5 text-xs text-red-500">删除</button>
        </div>}
      />
      {user.sessions.map((session) => <SettingsRow
        key={session.id}
        icon={MonitorX}
        title={<span className="block truncate">{session.device}</span>}
        description={`${session.ipAddress ? `${session.ipAddress} · ` : ""}${formatLoginTime(session.createdAt)}`}
        control={session.isCurrent
          ? <span className="shrink-0 text-xs font-bold" style={{ color: "var(--primary)" }}>当前设备</span>
          : <button type="button" onClick={() => void revokeSession(user, session)} className="btn-ghost flex h-11 min-h-11 shrink-0 items-center gap-1 px-2 py-0 text-xs text-red-500" title="踢出此设备"><MonitorX size={13} />踢出</button>}
      />)}
    </div>)}

    <SettingsRow
      icon={History}
      title="登录记录"
      description="最近 100 条"
      control={<SettingsBadge tone="muted">{loginRecords.length} 条</SettingsBadge>}
    />
    {loginRecords.length === 0
      ? <p className="mb-0 mt-1 text-xs muted">暂时没有登录记录。</p>
      : <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{loginRecords.map((record) => <SettingsRow
        key={record.id}
        title={<span className="block truncate">{record.displayName} <span className="font-normal muted">@{record.username}</span></span>}
        description={<>
          {formatLoginTime(record.createdAt)} · IP:{record.ipAddress || "未知"} · 设备:{record.device}
          {record.failureReason && <span className="block text-red-500">原因:{record.failureReason}</span>}
        </>}
        control={<SettingsBadge tone={record.success ? "success" : "warning"}>{record.success ? "成功" : "失败"}</SettingsBadge>}
      />)}</div>}

    {created && <CredentialsCard {...created} onCopy={copy} onClose={() => setCreated(null)} />}

    {resetCredential && <CredentialsCard {...resetCredential} onCopy={copy} onClose={() => setResetCredential(null)} />}

    <form onSubmit={create}>
      <SettingsRow
        stacked
        title="新增成员账号"
        description="创建后把用户名、初始密码和恢复码当面交给家人"
        control={<div className="grid w-full gap-2.5 sm:grid-cols-2">
          <div>
            <label className="ds-field-label" htmlFor="new-username">用户名</label>
            <input id="new-username" required className="input" placeholder="3-32 位小写字母或数字" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} autoComplete="off" spellCheck={false} maxLength={32} />
          </div>
          <div>
            <label className="ds-field-label" htmlFor="new-display-name">显示名称</label>
            <input id="new-display-name" required className="input" placeholder="家里怎么称呼他" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} autoComplete="off" maxLength={30} />
          </div>
          <div>
            <label className="ds-field-label" htmlFor="new-password">初始密码</label>
            <div className="relative">
              <input id="new-password" required minLength={PASSWORD_MIN_LENGTH} type={showFormPassword ? "text" : "password"} className="input input-icon-end" placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" maxLength={128} />
              <button type="button" onClick={() => setShowFormPassword((current) => !current)} className="icon-action absolute right-0.5 top-1/2 size-11 min-h-11 -translate-y-1/2" aria-label={showFormPassword ? "隐藏密码" : "显示密码"} title={showFormPassword ? "隐藏密码" : "显示密码"}>
                {showFormPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })} className="mt-1.5 inline-flex min-h-11 items-center text-xs font-bold" style={{ color: "var(--primary)" }}>生成强密码</button>
          </div>
          <div>
            <label className="ds-field-label" htmlFor="new-role">权限</label>
            <SettingsSelect id="new-role" ariaLabel="新账号权限" value={form.role as "MEMBER" | "VIEWER"} onChange={(value) => setForm({ ...form, role: value })} options={[["MEMBER", "成员"], ["VIEWER", "只读"]] as const} />
          </div>
        </div>}
      />
      <SettingsActions>
        <button disabled={creating} className="btn-primary flex items-center gap-2 text-xs disabled:cursor-not-allowed disabled:opacity-70">
          {creating ? <><Loader2 size={14} className="animate-spin" />正在创建...</> : <><UserPlus size={14} />创建账号</>}
        </button>
      </SettingsActions>
    </form>

    <SettingsActions>
      <button onClick={logout} className="btn-ghost flex items-center gap-2 text-xs"><LogOut size={14} />退出当前账号</button>
    </SettingsActions>
  </SettingsSection>

  <SettingsSection
    icon={ShieldCheck}
    title="密码与恢复码"
    summary={recoverySummary}
    badge={<SettingsBadge tone={recovery.hasCode ? "success" : "warning"}>{recovery.hasCode ? "已设置" : "未设置"}</SettingsBadge>}
  >
    <SettingsRow
      icon={KeyRound}
      title={recovery.loading ? "正在读取恢复码状态..." : recovery.hasCode ? "已设置恢复码" : "尚未设置恢复码"}
      description={recovery.loading ? "正在读取当前账号的恢复码状态。" : recovery.hasCode ? `生成于 ${recovery.generatedAt ? formatLoginTime(recovery.generatedAt) : "未知时间"},忘记密码时可以凭它重置。` : "设置后忘记密码也能自己重置,不必等管理员帮忙。"}
    />
    <SettingsActions>
      <button type="button" onClick={() => { setRecoveryPassword(""); setRecoveryError(""); setShowRecoveryPassword(false); setRecoveryOpen(true); }} className="btn-primary flex items-center gap-2 text-xs">
        <KeyRound size={14} />{recovery.hasCode ? "重新生成恢复码" : "生成恢复码"}
      </button>
    </SettingsActions>
    {recoveryCode && <CredentialsCard title="新的恢复码已生成" hint="恢复码只显示这一次,请立刻抄写或存进密码管理器;重新生成后旧码立即失效。" recoveryCode={recoveryCode} onCopy={copy} onClose={() => setRecoveryCode(null)} />}
  </SettingsSection>

  <AnimatePresence>
    {resetTarget && (
      <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setResetTarget(null); }}>
        <motion.form
          aria-modal="true"
          role="dialog"
          aria-labelledby="reset-password-title"
          onSubmit={submitReset}
          initial={{ opacity: 0, y: 12, scale: .98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: .98 }}
          className="w-full max-w-sm rounded-3xl p-5 shadow-2xl"
          style={{ background: "var(--surface-solid)" }}
        >
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><KeyRound size={19} /></div>
            <div className="min-w-0 flex-1">
              <h3 id="reset-password-title" className="m-0 text-base font-black">重置 {resetTarget.displayName} 的密码</h3>
              <p className="mb-0 mt-1 text-xs leading-5 muted">设置一个临时密码,再当面告诉家人。改完密码后让对方重新登录。</p>
            </div>
            <button type="button" onClick={() => setResetTarget(null)} className="icon-action size-11 min-h-11 shrink-0" aria-label="关闭重置密码" title="关闭"><X size={16} /></button>
          </div>

          <div className="mt-4">
            <label className="ds-field-label" htmlFor="reset-password-input">新密码</label>
            <div className="relative">
              <input
                id="reset-password-input"
                type={showResetPassword ? "text" : "password"}
                className="input input-icon-end"
                value={resetPassword}
                onChange={(event) => { setResetPassword(event.target.value); setResetError(""); }}
                placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                autoComplete="new-password"
                autoFocus
                maxLength={128}
                aria-invalid={Boolean(resetError)}
                aria-describedby={resetError ? "reset-password-error" : undefined}
              />
              <button type="button" onClick={() => setShowResetPassword((current) => !current)} className="icon-action absolute right-0.5 top-1/2 size-11 min-h-11 -translate-y-1/2" aria-label={showResetPassword ? "隐藏密码" : "显示密码"} title={showResetPassword ? "隐藏密码" : "显示密码"}>
                {showResetPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {resetError && <p id="reset-password-error" className="m-0 mt-2 text-xs font-semibold" style={{ color: "var(--danger)" }}>{resetError}</p>}
            <button type="button" onClick={() => { setResetPassword(generatePassword()); setResetError(""); }} className="mt-2 inline-flex min-h-11 items-center text-xs font-bold" style={{ color: "var(--primary)" }}>生成强密码</button>
          </div>

          <div className="mt-5 flex gap-3">
            <button type="button" onClick={() => setResetTarget(null)} className="btn-ghost flex-1">取消</button>
            <button type="submit" disabled={resetting} className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-70">
              {resetting ? <><Loader2 size={15} className="animate-spin" />正在重置...</> : "确认重置"}
            </button>
          </div>
        </motion.form>
      </motion.div>
    )}
  </AnimatePresence>

  <AnimatePresence>
    {recoveryOpen && (
      <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setRecoveryOpen(false); }}>
        <motion.form
          aria-modal="true"
          role="dialog"
          aria-labelledby="recovery-code-title"
          onSubmit={mintRecoveryCode}
          initial={{ opacity: 0, y: 12, scale: .98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: .98 }}
          className="w-full max-w-sm rounded-3xl p-5 shadow-2xl"
          style={{ background: "var(--surface-solid)" }}
        >
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><ShieldCheck size={19} /></div>
            <div className="min-w-0 flex-1">
              <h3 id="recovery-code-title" className="m-0 text-base font-black">{recovery.hasCode ? "重新生成恢复码" : "生成恢复码"}</h3>
              <p className="mb-0 mt-1 text-xs leading-5 muted">先用当前登录账号的密码确认身份。生成后新码只显示这一次,旧恢复码立即失效。</p>
            </div>
            <button type="button" onClick={() => setRecoveryOpen(false)} className="icon-action size-11 min-h-11 shrink-0" aria-label="关闭生成恢复码" title="关闭"><X size={16} /></button>
          </div>

          <div className="mt-4">
            <label className="ds-field-label" htmlFor="recovery-current-password">当前密码</label>
            <div className="relative">
              <input
                id="recovery-current-password"
                type={showRecoveryPassword ? "text" : "password"}
                className="input input-icon-end"
                value={recoveryPassword}
                onChange={(event) => { setRecoveryPassword(event.target.value); setRecoveryError(""); }}
                placeholder="当前登录账号的密码"
                autoComplete="current-password"
                autoFocus
                maxLength={128}
                aria-invalid={Boolean(recoveryError)}
                aria-describedby={recoveryError ? "recovery-code-error" : undefined}
              />
              <button type="button" onClick={() => setShowRecoveryPassword((current) => !current)} className="icon-action absolute right-0.5 top-1/2 size-11 min-h-11 -translate-y-1/2" aria-label={showRecoveryPassword ? "隐藏密码" : "显示密码"} title={showRecoveryPassword ? "隐藏密码" : "显示密码"}>
                {showRecoveryPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {recoveryError && <p id="recovery-code-error" className="m-0 mt-2 text-xs font-semibold" style={{ color: "var(--danger)" }}>{recoveryError}</p>}
          </div>

          <div className="mt-5 flex gap-3">
            <button type="button" onClick={() => setRecoveryOpen(false)} className="btn-ghost flex-1">取消</button>
            <button type="submit" disabled={recoveryBusy} className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-70">
              {recoveryBusy ? <><Loader2 size={15} className="animate-spin" />正在生成...</> : "确认生成"}
            </button>
          </div>
        </motion.form>
      </motion.div>
    )}
  </AnimatePresence>
  </>;
}
