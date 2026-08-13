"use client";

import { FormEvent, useEffect, useState } from "react";

type AuthUser = { id: string; username: string; displayName: string; role: "ADMIN" | "MEMBER" | "VIEWER" };

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const check = () => fetch("/api/auth/session").then((response) => response.json()).then((result) => { setSetupRequired(Boolean(result.setupRequired)); setAuthenticated(Boolean(result.authenticated)); }).catch(() => setError("无法连接服务器，请稍后重试")).finally(() => setReady(true));
  useEffect(() => { void check(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    const endpoint = setupRequired ? "/api/auth/setup" : "/api/auth/login";
    const body = setupRequired ? { username, displayName, password } : { username, password };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "操作失败"); return; }
    setPassword(""); setAuthenticated(true); setSetupRequired(false);
  };
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm muted">正在检查账号状态…</div>;
  if (authenticated) return <>{children}</>;
  return <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-4"><form onSubmit={submit} className="surface w-full max-w-sm rounded-3xl p-6 shadow-xl"><h1 className="m-0 text-2xl font-black">归物 HomeInventory</h1><p className="mt-2 text-sm muted">{setupRequired ? "首次使用，请创建管理员账号" : "登录你的家庭库存"}</p><input required minLength={3} maxLength={32} autoFocus className="input mt-5" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" autoComplete="username" />{setupRequired && <input required maxLength={30} className="input mt-3" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" /> }<input required minLength={8} type="password" className="input mt-3" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码（至少 8 位）" autoComplete={setupRequired ? "new-password" : "current-password"} />{error && <p className="mt-3 text-sm text-red-500">{error}</p>}<button className="btn-primary mt-4 w-full">{setupRequired ? "创建管理员并进入" : "登录"}</button></form></main>;
}

export type { AuthUser };
