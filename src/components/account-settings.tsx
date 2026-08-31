"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, History, LogOut, MonitorX, ShieldCheck, UserPlus, Users, XCircle } from "lucide-react";

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

function formatLoginTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function AccountSettings({ onToast }: { onToast: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loginRecords, setLoginRecords] = useState<LoginRecord[]>([]);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "MEMBER" });

  const load = useCallback(async () => {
    const [usersResponse, recordsResponse] = await Promise.all([fetch("/api/auth/users"), fetch("/api/auth/login-records")]);
    if (usersResponse.ok) setUsers(await usersResponse.json());
    if (recordsResponse.ok) setLoginRecords(await recordsResponse.json());
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load().catch(() => undefined); });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/auth/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "创建失败"); return; }
    setForm({ username: "", displayName: "", password: "", role: "MEMBER" });
    await load();
    onToast("账号已创建");
  };

  const updateUser = async (user: User, patch: Record<string, unknown>) => {
    const response = await fetch(`/api/auth/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "更新失败"); return; }
    await load();
    onToast("账号已更新");
  };

  const removeUser = async (user: User) => {
    if (!confirm(`确定删除账号“${user.displayName}”？`)) return;
    const response = await fetch(`/api/auth/users/${user.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "删除失败"); return; }
    await load();
    onToast("账号已删除");
  };

  const revokeSession = async (user: User, session: User["sessions"][number]) => {
    if (!confirm(`确定踢出“${user.displayName}”在 ${session.device} 上的登录吗？该设备需要重新登录。`)) return;
    const response = await fetch(`/api/auth/sessions/${session.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { onToast(result.error || "踢出设备失败"); return; }
    await load();
    onToast("该设备已退出登录");
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); location.reload(); };

  return <details className="surface group rounded-3xl p-5">
    <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
      <div className="grid size-11 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Users size={20} /></div>
      <div className="min-w-0 flex-1"><h3 className="m-0 text-sm font-black">账号与家庭成员</h3><p className="mb-0 mt-1 truncate text-xs muted">管理登录账号、权限和登录记录</p></div>
      <ChevronDown size={17} className="muted transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-5 space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <div className="space-y-2">
        {users.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-2 rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{user.displayName}</div>
            <div className="text-xs muted">@{user.username} · 权限：{roleLabel(user.role)}</div>
            {user.lastLogin && <div className="mt-1 text-[11px] leading-4 muted">最近登录：{user.lastLogin.ipAddress || "未知 IP"} · {user.lastLogin.device} · {formatLoginTime(user.lastLogin.createdAt)}</div>}
          </div>
          <select aria-label={`${user.displayName}的账号权限`} title="账号权限" className="input h-10 min-w-28 px-3 text-sm font-semibold leading-5" value={user.role} onChange={(event) => void updateUser(user, { role: event.target.value })}>
            <option value="ADMIN">管理员</option><option value="MEMBER">成员</option><option value="VIEWER">只读</option>
          </select>
          <button onClick={() => void updateUser(user, { active: !user.active })} className="btn-ghost px-2.5 py-1.5 text-xs">{user.active ? "停用" : "启用"}</button>
          <button onClick={() => { const password = prompt("输入新密码（至少 8 位）"); if (password) void updateUser(user, { password }); }} className="btn-ghost px-2.5 py-1.5 text-xs">重置密码</button>
          <button onClick={() => void removeUser(user)} className="btn-ghost px-2.5 py-1.5 text-xs text-red-500">删除</button>
          <span className="text-xs muted">{user.active ? "正常" : "已停用"}</span>
          {user.sessions.length > 0 && <div className="basis-full border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold muted"><ShieldCheck size={13} />已登录设备 · {user.sessions.length}</div>
            <div className="space-y-1.5">{user.sessions.map((session) => <div key={session.id} className="flex min-w-0 items-center gap-2 text-[11px] muted">
              <span className="min-w-0 flex-1 truncate">{session.device}{session.ipAddress ? ` · ${session.ipAddress}` : ""} · {formatLoginTime(session.createdAt)}</span>
              {session.isCurrent ? <span className="shrink-0" style={{ color: "var(--primary)" }}>当前设备</span> : <button type="button" onClick={() => void revokeSession(user, session)} className="btn-ghost flex h-7 shrink-0 items-center gap-1 px-2 text-[11px] text-red-500" title="踢出此设备"><MonitorX size={13} />踢出</button>}
            </div>)}</div>
          </div>}
        </div>)}
      </div>

      <section className="rounded-2xl border p-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2"><History size={16} style={{ color: "var(--primary)" }} /><div className="text-sm font-bold">登录记录</div><span className="ml-auto text-[11px] muted">最近 100 条</span></div>
        {loginRecords.length === 0 ? <p className="mb-0 mt-3 text-xs muted">暂时没有登录记录。</p> : <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">{loginRecords.map((record) => <div key={record.id} className="rounded-xl p-2.5" style={{ background: "var(--surface-soft)" }}>
          <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{record.displayName} <span className="font-normal muted">@{record.username}</span></div><div className="mt-0.5 text-[11px] muted">{formatLoginTime(record.createdAt)}</div></div>{record.success ? <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--success)" }}><CheckCircle2 size={13} />成功</span> : <span className="flex items-center gap-1 text-[11px] text-red-500"><XCircle size={13} />失败</span>}</div>
          <div className="mt-2 grid gap-1 text-[11px] muted sm:grid-cols-2"><span>IP：{record.ipAddress || "未知"}</span><span>设备：{record.device}</span></div>
          {record.failureReason && <div className="mt-1 text-[11px] text-red-500">原因：{record.failureReason}</div>}
        </div>)}</div>}
      </section>

      <form onSubmit={create} className="space-y-2"><div className="text-xs font-bold muted">新增成员账号</div><div className="grid gap-2 sm:grid-cols-2">
        <input required className="input" placeholder="用户名" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        <input required className="input" placeholder="显示名称" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
        <input required minLength={8} type="password" className="input" placeholder="初始密码（至少 8 位）" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <select aria-label="新账号权限" title="新账号权限" className="input text-sm font-semibold" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="MEMBER">成员</option><option value="VIEWER">只读</option></select>
      </div><button className="btn-primary flex items-center gap-2 text-xs"><UserPlus size={14} />创建账号</button></form>
      <button onClick={logout} className="btn-ghost flex items-center gap-2 text-xs"><LogOut size={14} />退出当前账号</button>
    </div>
  </details>;
}
