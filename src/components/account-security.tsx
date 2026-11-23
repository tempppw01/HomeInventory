"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { SettingsActions, SettingsRow, SettingsSection } from "@/components/settings-primitives";

/**
 * 「我的密码」—— 所有已登录角色都能用。
 *
 * 此前设置页里 `{isAdmin && <AccountSettings/>}`,于是成员 / 只读账号**根本没有改自己密码的入口**:
 * 要么麻烦管理员在账号面板里替你重置,要么用恢复码走一次「忘记密码」—— 而后者会顺带轮换恢复码。
 * 「我只想换个密码」没有对应的路。现在这块对所有角色渲染;账号管理(创建 / 角色 / 停用 / 删除)
 * 仍然只给管理员。
 *
 * 接口层也一样:middleware 对只读账号拦的是**家庭数据**的写操作,自己的密码属于自助操作,
 * 已在 middleware 里单独放行(/api/auth/password)。
 */
export function AccountSecurity({ onToast }: { onToast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((old) => ({ ...old, ...patch }));

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
  );
}