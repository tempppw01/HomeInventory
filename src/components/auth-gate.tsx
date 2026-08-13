"use client";

import { FormEvent, useEffect, useState } from "react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const check = () => fetch("/api/auth/session").then((response) => response.json()).then((result) => { setEnabled(Boolean(result.enabled)); setAuthenticated(Boolean(result.authenticated)); }).catch(() => setError("无法连接服务器，请稍后重试")).finally(() => setReady(true));
  useEffect(() => { void check(); }, []);
  const login = async (event: FormEvent) => { event.preventDefault(); setError(""); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); const result = await response.json(); if (!response.ok) { setError(result.error || "登录失败"); return; } setPassword(""); setAuthenticated(true); };
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm muted">正在检查访问权限…</div>;
  if (!enabled || authenticated) return <>{children}</>;
  return <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-4"><form onSubmit={login} className="surface w-full max-w-sm rounded-3xl p-6 shadow-xl"><h1 className="m-0 text-2xl font-black">归物 HomeInventory</h1><p className="mt-2 text-sm muted">请输入家庭访问密码</p><input autoFocus type="password" className="input mt-5" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="访问密码" autoComplete="current-password" />{error && <p className="mt-3 text-sm text-red-500">{error}</p>}<button className="btn-primary mt-4 w-full">进入库存</button></form></main>;
}
