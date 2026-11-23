"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, ClipboardCopy, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";

import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { SettingsActions, SettingsRow, SettingsSection } from "@/components/settings-primitives";

/** 与管理员面板里一致的时间格式。 */
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/**
 * 「我的密码」—— 所有已登录角色都能用。
 *
 * 此前设置页里 `{isAdmin && <AccountSettings/>}`,于是成员 / 只读账号**根本没有改自己密码的入口**:
 * 要么麻烦管理员在账号面板里替你重置,要么用恢复码走一次「忘记密码」—— 而后者会顺带轮换恢复码。
 * 「我只想换个密码」没有对应的路。现在这块对所有角色渲染;账号管理(创建 / 角色 / 停用 / 删除)
 * 仍然只给管理员。
 *
 * 接口层也一样:middleware 对只读账号拦的是**家庭数据**的写操作,自己的密码与恢复码属于自助操作,
 * 已在 middleware 里单独放行(/api/auth/password、/api/auth/recovery)。
 *
 * 恢复码原本只放在管理员面板里 —— 成员与只读只能用建号时管理员给的那一张,
 * 想换一张就没办法了(而「找回自己的密码」本来不该需要管理员)。现在两块都在这里。
 */
export function AccountSecurity({ onToast }: { onToast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((old) => ({ ...old, ...patch }));

  // ---------- 恢复码 ----------
  const [recovery, setRecovery] = useState<{ loading: boolean; hasCode: boolean; generatedAt: string | null }>({ loading: true, hasCode: false, generatedAt: null });
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const loadRecovery = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/recovery");
      if (!response.ok) { setRecovery((current) => ({ ...current, loading: false })); return; }
      const result = await response.json();
      setRecovery({ loading: false, hasCode: Boolean(result.hasCode), generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : null });
    } catch {
      setRecovery((current) => ({ ...current, loading: false }));
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void loadRecovery(); });
    return () => cancelAnimationFrame(frame);
  }, [loadRecovery]);

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
      await loadRecovery();
      onToast("恢复码已生成,请立刻保存");
    } catch {
      setRecoveryError("网络异常,请稍后重试");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyRecoveryCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      onToast("恢复码已复制");
    } catch {
      onToast("复制失败,请手动选择文本复制");
    }
  };

  const recoverySummary = recovery.loading
    ? "正在读取恢复码状态..."
    : recovery.hasCode
      ? `已设置恢复码${recovery.generatedAt ? ` · 生成于 ${formatTime(recovery.generatedAt)}` : ""}`
      : "尚未设置恢复码";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.current) { setError("请输入当前密码"); return; }
    if (form.next.length < PASSWORD_MIN_LENGTH) { setError(`新密码至少 ${PASSWORD_MIN_LENGTH} 位`); return; }
    if (form.next !== form.confirm) { setError("两次输入的新密码不一致"); return; }
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "修改失败,请稍后重试"); return; }
      setForm({ current: "", next: "", confirm: "" });
      setOpen(false);
      setShow(false);
      onToast("密码已更新,其它设备上的登录已失效");
    } catch {
      setError("网络连接失败,请检查网络后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <SettingsSection
      icon={KeyRound}
      title="我的密码"
      summary={open ? "正在修改登录密码" : "登录密码可以自己改,不需要麻烦管理员"}
    >
      <SettingsRow
        icon={KeyRound}
        title="登录密码"
        description="改密码需要先输入当前密码;改完之后,其它设备上的登录会立刻失效。"
      />
      <SettingsActions>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setForm({ current: "", next: "", confirm: "" }); setError(""); setOpen((value) => !value); }} className="btn-ghost flex items-center gap-2 text-xs" aria-expanded={open}>
            <KeyRound size={14} />{open ? "收起" : "修改我的密码"}
          </button>
        </div>
      </SettingsActions>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3 rounded-[20px] p-3" style={{ background: "var(--surface-solid)" }}>
          <div>
            <label className="ds-field-label" htmlFor="self-current-password">当前密码</label>
            <div className="relative">
              <input
                id="self-current-password"
                type={show ? "text" : "password"}
                className="input input-icon-end"
                value={form.current}
                onChange={(event) => { set({ current: event.target.value }); setError(""); }}
                placeholder="当前登录账号的密码"
                autoComplete="current-password"
                autoFocus
                maxLength={200}
              />
              <button type="button" onClick={() => setShow((value) => !value)} className="icon-action absolute right-0.5 top-1/2 size-11 min-h-11 -translate-y-1/2" aria-label={show ? "隐藏密码" : "显示密码"}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="ds-field-label" htmlFor="self-new-password">新密码</label>
              <input
                id="self-new-password"
                type={show ? "text" : "password"}
                className="input"
                value={form.next}
                onChange={(event) => { set({ next: event.target.value }); setError(""); }}
                placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                autoComplete="new-password"
                maxLength={200}
              />
            </div>
            <div>
              <label className="ds-field-label" htmlFor="self-confirm-password">再输一次新密码</label>
              <input
                id="self-confirm-password"
                type={show ? "text" : "password"}
                className="input"
                value={form.confirm}
                onChange={(event) => { set({ confirm: event.target.value }); setError(""); }}
                placeholder="两次要一致"
                autoComplete="new-password"
                maxLength={200}
                aria-invalid={Boolean(error)}
              />
            </div>
          </div>
          {error && <p className="m-0 text-xs font-semibold" style={{ color: "var(--danger)" }} role="alert">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70">
              {busy ? <><Loader2 size={15} className="animate-spin" />正在保存...</> : "保存新密码"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setForm({ current: "", next: "", confirm: "" }); setError(""); }} className="btn-ghost">取消</button>
            <span className="text-xs muted">忘记当前密码?用恢复码走一次「忘记密码」。</span>
          </div>
        </form>
      )}
    </SettingsSection>

    {/* 恢复码:同样面向所有角色。此前这一块只在管理员面板里,成员/只读只能用建号时那张,
        而「找回自己的密码」本来就不该需要管理员帮忙。 */}
    <SettingsSection
      icon={ShieldCheck}
      title="恢复码"
      summary={recoverySummary}
    >
      <SettingsRow
        icon={ShieldCheck}
        title={recovery.loading ? "正在读取恢复码状态..." : recovery.hasCode ? "已设置恢复码" : "尚未设置恢复码"}
        description={recovery.loading
          ? "正在读取当前账号的恢复码状态。"
          : recovery.hasCode
            ? `生成于 ${recovery.generatedAt ? formatTime(recovery.generatedAt) : "未知时间"},忘记密码时可以凭它重置。重新生成后旧码立即失效。`
            : "设置后忘记密码也能自己重置,不必等管理员帮忙。"}
      />
      <SettingsActions>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setRecoveryPassword(""); setRecoveryError(""); setShowRecoveryPassword(false); setRecoveryOpen((value) => !value); setRecoveryCode(null); }}
            className="btn-ghost flex items-center gap-2 text-xs"
            aria-expanded={recoveryOpen}
          >
            <KeyRound size={14} />{recovery.hasCode ? "重新生成恢复码" : "生成恢复码"}
          </button>
        </div>
      </SettingsActions>

      {recoveryOpen && (
        <form onSubmit={mintRecoveryCode} className="mt-3 space-y-3 rounded-[20px] p-3" style={{ background: "var(--surface-solid)" }}>
          <p className="m-0 text-xs leading-5 muted">先用当前账号的密码确认身份。生成后新码只显示这一次,旧恢复码立即失效。</p>
          <div>
            <label className="ds-field-label" htmlFor="self-recovery-password">当前密码</label>
            <div className="relative">
              <input
                id="self-recovery-password"
                type={showRecoveryPassword ? "text" : "password"}
                className="input input-icon-end"
                value={recoveryPassword}
                onChange={(event) => { setRecoveryPassword(event.target.value); setRecoveryError(""); }}
                placeholder="当前登录账号的密码"
                autoComplete="current-password"
                autoFocus
                maxLength={200}
                aria-invalid={Boolean(recoveryError)}
              />
              <button type="button" onClick={() => setShowRecoveryPassword((value) => !value)} className="icon-action absolute right-0.5 top-1/2 size-11 min-h-11 -translate-y-1/2" aria-label={showRecoveryPassword ? "隐藏密码" : "显示密码"}>
                {showRecoveryPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {recoveryError && <p className="m-0 text-xs font-semibold" style={{ color: "var(--danger)" }} role="alert">{recoveryError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={recoveryBusy} className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70">
              {recoveryBusy ? <><Loader2 size={15} className="animate-spin" />正在生成...</> : "确认生成"}
            </button>
            <button type="button" onClick={() => { setRecoveryOpen(false); setRecoveryPassword(""); setRecoveryError(""); }} className="btn-ghost">取消</button>
          </div>
        </form>
      )}

      {recoveryCode && (
        <div className="mt-3 rounded-[20px] p-3" style={{ background: "var(--primary-soft)" }}>
          <div className="flex items-center gap-2 text-sm font-black" style={{ color: "var(--primary-strong)" }}>
            <Check size={16} />新的恢复码已生成
          </div>
          <p className="mb-0 mt-1 text-xs leading-5" style={{ color: "var(--foreground)", opacity: 0.8 }}>只显示这一次,请立刻抄写或存进密码管理器;重新生成后旧码立即失效。</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="flex-1 break-all rounded-xl px-2 py-1.5 font-mono text-sm" style={{ background: "var(--surface-solid)" }}>{recoveryCode}</code>
            <button type="button" onClick={() => void copyRecoveryCode(recoveryCode)} className="btn-ghost flex shrink-0 items-center gap-1.5 text-xs" aria-label="复制恢复码">
              <ClipboardCopy size={14} />复制
            </button>
            <button type="button" onClick={() => setRecoveryCode(null)} className="btn-ghost shrink-0 text-xs">我已保存</button>
          </div>
        </div>
      )}
    </SettingsSection>
  </>
  );
}