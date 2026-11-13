"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { generatePassword, passwordStrength, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from "@/lib/password";
import { formatRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_LENGTH } from "@/lib/recovery-code";

type AuthUser = { id: string; username: string; displayName: string; role: "ADMIN" | "MEMBER" | "VIEWER" };

type FieldKey = "username" | "displayName" | "password";

/** 视图:登录/首次创建管理员、自助找回、重置成功(新恢复码只展示一次)。 */
type AuthView = "credentials" | "recovery" | "recovery-done";

/** 与 src/app/api/auth/recovery/reset/route.ts 的 recoveryResetSchema 保持一致。 */
const PASSWORD_MAX_LENGTH = 72;
const USERNAME_ERROR_MESSAGE = "只能使用小写字母、数字、. _ -,且以字母或数字开头";

/** 输入时实时大写 + 分组展示;不足 16 位时保留紧凑形式,避免打字中途出现悬空连字符。 */
function displayRecoveryCode(input: string): string {
  const compact = normalizeRecoveryCode(input);
  if (compact.length >= RECOVERY_CODE_LENGTH) return formatRecoveryCode(compact);
  return compact;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({ username: false, displayName: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState<AuthView>("credentials");

  // 「找回密码」是一套独立字段,不覆盖登录表单,返回登录时输入还在。
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [showRecoveryConfirm, setShowRecoveryConfirm] = useState(false);
  const [recoveryTouched, setRecoveryTouched] = useState({ username: false, code: false, password: false, confirm: false });
  const [recoverySubmitted, setRecoverySubmitted] = useState(false);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) throw new Error("session");
    return (await response.json()) as { setupRequired?: boolean; authenticated?: boolean };
  }, []);

  const applySession = useCallback((result: { setupRequired?: boolean; authenticated?: boolean }) => {
    setSetupRequired(Boolean(result.setupRequired));
    setAuthenticated(Boolean(result.authenticated));
    setLoadError("");
  }, []);

  const check = useCallback(async () => {
    try {
      applySession(await loadSession());
    } catch {
      setLoadError("无法连接服务器,请检查网络后重试");
    } finally {
      setReady(true);
    }
  }, [applySession, loadSession]);

  useEffect(() => {
    let active = true;
    // Probing through a promise keeps state writes out of the synchronous effect
    // body and avoids updating state after the component has unmounted.
    loadSession()
      .then((result) => { if (active) applySession(result); })
      .catch(() => { if (active) setLoadError("无法连接服务器,请检查网络后重试"); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [applySession, loadSession]);

  // Escape 从找回/结果视图退回登录视图。
  useEffect(() => {
    if (view === "credentials") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setView("credentials");
      setRecoveryError("");
      setRecoverySubmitting(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  // Retrying is a user event, so clearing the previous error here keeps the
  // session check itself free of synchronous state writes inside an effect.
  const retry = () => {
    setLoadError("");
    setReady(false);
    void check();
  };

  const usernameError = username && !USERNAME_PATTERN.test(username) ? USERNAME_ERROR_MESSAGE : "";
  const displayNameError = setupRequired && !displayName.trim() ? "请填写显示名称" : "";
  const passwordError = password && password.length < PASSWORD_MIN_LENGTH ? `密码至少需要 ${PASSWORD_MIN_LENGTH} 位` : "";

  const fieldError = (key: FieldKey, message: string) => {
    if (!message) return "";
    if (!touched[key] && !submitted) return "";
    return message;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setTouched({ username: true, displayName: true, password: true });
    if (!USERNAME_PATTERN.test(username) || password.length < PASSWORD_MIN_LENGTH || (setupRequired && !displayName.trim())) {
      setError("请先补全上面标红的内容");
      return;
    }
    setError("");
    setSubmitting(true);
    const endpoint = setupRequired ? "/api/auth/setup" : "/api/auth/login";
    const body = setupRequired
      ? { username, displayName, password, remember }
      : { username, password, remember };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "操作失败");
        return;
      }
      setPassword("");
      setAuthenticated(true);
      setSetupRequired(false);
    } catch {
      setError("网络连接失败,请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const openRecovery = () => {
    setRecoveryUsername(username);
    setRecoveryCode("");
    setRecoveryPassword("");
    setRecoveryConfirm("");
    setRecoveryError("");
    setRecoveryTouched({ username: false, code: false, password: false, confirm: false });
    setRecoverySubmitted(false);
    setCopyState("idle");
    setView("recovery");
  };

  const backToLogin = () => {
    setView("credentials");
    setRecoveryError("");
  };

  const recoveryUsernameError = recoveryUsername && !USERNAME_PATTERN.test(recoveryUsername) ? USERNAME_ERROR_MESSAGE : "";
  const recoveryCodeError = recoveryCode && recoveryCode.replace(/[^A-Z0-9]/g, "").length !== RECOVERY_CODE_LENGTH
    ? `恢复码是 ${RECOVERY_CODE_LENGTH} 位`
    : "";
  const recoveryPasswordError = recoveryPassword && recoveryPassword.length < PASSWORD_MIN_LENGTH
    ? `密码至少需要 ${PASSWORD_MIN_LENGTH} 位`
    : "";
  const recoveryConfirmError = recoveryConfirm && recoveryPassword !== recoveryConfirm ? "两次输入的密码不一致" : "";
  const recoveryFieldError = (key: keyof typeof recoveryTouched, message: string) => {
    if (!message) return "";
    if (!recoveryTouched[key] && !recoverySubmitted) return "";
    return message;
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setRecoverySubmitted(true);
    setRecoveryTouched({ username: true, code: true, password: true, confirm: true });
    const compactCode = normalizeRecoveryCode(recoveryCode);
    if (
      !USERNAME_PATTERN.test(recoveryUsername)
      || compactCode.length !== RECOVERY_CODE_LENGTH
      || recoveryPassword.length < PASSWORD_MIN_LENGTH
      || recoveryPassword.length > PASSWORD_MAX_LENGTH
      || recoveryPassword !== recoveryConfirm
    ) {
      setRecoveryError("请先补全上面标红的内容");
      return;
    }
    setRecoveryError("");
    setRecoverySubmitting(true);
    try {
      const response = await fetch("/api/auth/recovery/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: recoveryUsername, code: compactCode, password: recoveryPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        // 401 的文案由服务端统一给出,前端不区分「账号不存在」与「恢复码错误」。
        setRecoveryError(result.error || "重置失败,请稍后再试");
        return;
      }
      const rotated = typeof result.code === "string" ? result.code : "";
      setNewRecoveryCode(rotated);
      setRecoveryUsername(typeof result.username === "string" ? result.username : recoveryUsername);
      setRecoveryPassword("");
      setRecoveryConfirm("");
      setRecoveryCode("");
      setCopyState("idle");
      setView("recovery-done");
    } catch {
      setRecoveryError("网络连接失败,请检查网络后重试");
    } finally {
      setRecoverySubmitting(false);
    }
  };

  const copyRecoveryCode = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formatRecoveryCode(newRecoveryCode) || newRecoveryCode);
        setCopyState("copied");
        return;
      }
      throw new Error("clipboard");
    } catch {
      // http 访问或浏览器限制时给出降级提示,让用户手动抄写。
      setCopyState("failed");
    }
  };

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl text-[var(--on-primary)] shadow-lg" style={{ background: "var(--primary)" }}>
            <Archive size={22} />
          </span>
          <p className="m-0 text-sm muted">正在检查账号状态...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--background)] px-4">
        <div className="surface w-full max-w-sm rounded-3xl p-6 text-center shadow-xl">
          <span className="mx-auto grid size-11 place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>
            <AlertCircle size={21} />
          </span>
          <h1 className="mb-0 mt-4 text-lg font-black">连接不上服务器</h1>
          <p className="mb-0 mt-2 text-sm muted">{loadError}</p>
          <button type="button" onClick={retry} className="btn-primary mt-5 flex w-full items-center justify-center gap-2">
            <RefreshCw size={16} />重新尝试
          </button>
        </div>
      </div>
    );
  }

  if (authenticated) return <>{children}</>;

  const doneCode = formatRecoveryCode(newRecoveryCode) || newRecoveryCode;

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="auth-brand-inner">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl text-[var(--on-primary)] shadow-lg" style={{ background: "var(--primary)" }}>
              <Archive size={22} />
            </span>
            <div>
              <div className="flex items-center gap-2 text-lg font-black tracking-tight">
                归物
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "color-mix(in srgb, var(--brand-accent) 20%, transparent)", color: "var(--brand-accent)" }}>
                  HOME INVENTORY
                </span>
              </div>
              <div className="text-[11px] font-semibold tracking-[.16em] muted">家的每一件东西,都有位置</div>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center py-10">
            <h2 className="mb-0 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              把家里的杂物
              <br />
              收得井井有条
            </h2>
            <p className="mb-0 mt-4 max-w-sm text-sm leading-6" style={{ color: "var(--brand-muted)" }}>
              记录物品放在哪里、还剩多少、什么时候该补货。
              家里每个人都能随时查到,动线更短,心更安定。
            </p>

            <ul className="mb-0 mt-9 grid list-none gap-3.5 p-0">
              <li className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>
                  <MapPin size={17} />
                </span>
                <div>
                  <div className="text-sm font-bold">位置一目了然</div>
                  <div className="text-xs" style={{ color: "var(--brand-muted)" }}>按房间和柜子分层,找东西不用翻箱倒柜</div>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in srgb, var(--brand-accent) 18%, transparent)", color: "var(--brand-accent)" }}>
                  <Sparkles size={17} />
                </span>
                <div>
                  <div className="text-sm font-bold">临期和补货自动提醒</div>
                  <div className="text-xs" style={{ color: "var(--brand-muted)" }}>快过期的先吃掉,快用完的顺手加进采购清单</div>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in srgb, var(--brand-sage) 20%, transparent)", color: "var(--brand-sage)" }}>
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <div className="text-sm font-bold">家人各有账号</div>
                  <div className="text-xs" style={{ color: "var(--brand-muted)" }}>管理员、成员、只读三种权限,数据留在自己的服务器</div>
                </div>
              </li>
            </ul>
          </div>

          <p className="mb-0 text-xs" style={{ color: "var(--brand-muted)" }}>
            归物 HomeInventory · 数据保存在你自己的设备上
          </p>
        </div>
        <HomeArtwork />
      </aside>

      <main className="auth-panel">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-10 place-items-center rounded-2xl text-[var(--on-primary)] shadow-lg" style={{ background: "var(--primary)" }}>
              <Archive size={20} />
            </span>
            <div>
              <div className="text-base font-black">归物 HomeInventory</div>
              <div className="text-[11px] muted">家的每一件东西,都有位置</div>
            </div>
          </div>

          {view === "credentials" && (
            <>
              <div className="mb-6">
                <h1 className="mb-0 text-2xl font-black tracking-tight">
                  {setupRequired ? "创建管理员账号" : "欢迎回家"}
                </h1>
                <p className="mb-0 mt-2 text-sm muted">
                  {setupRequired
                    ? "这是第一次使用,先创建一个管理员账号,之后可以邀请家人加入。"
                    : "登录后继续管理家里的物品清单。"}
                </p>
              </div>

              <form onSubmit={submit} noValidate className="space-y-4">
                <div className="ds-form-field">
                  <label className="ds-field-label" htmlFor="auth-username">用户名</label>
                  <div className="relative">
                    <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
                    <input
                      id="auth-username"
                      className="input input-icon"
                      value={username}
                      onChange={(event) => { setUsername(event.target.value.toLowerCase()); setError(""); }}
                      onBlur={() => setTouched((current) => ({ ...current, username: true }))}
                      placeholder="例如:xiaoming"
                      autoComplete="username"
                      autoFocus
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={32}
                      aria-invalid={Boolean(fieldError("username", usernameError))}
                      aria-describedby="auth-username-hint"
                    />
                  </div>
                  <span id="auth-username-hint" className="ds-field-hint" style={fieldError("username", usernameError) ? { color: "var(--danger)" } : undefined}>
                    {fieldError("username", usernameError) || "3-32 位小写字母、数字或 ._-,登录时用它"}
                  </span>
                </div>

                {setupRequired && (
                  <div className="ds-form-field">
                    <label className="ds-field-label" htmlFor="auth-display-name">显示名称</label>
                    <input
                      id="auth-display-name"
                      className="input"
                      value={displayName}
                      onChange={(event) => { setDisplayName(event.target.value); setError(""); }}
                      onBlur={() => setTouched((current) => ({ ...current, displayName: true }))}
                      placeholder="家里怎么称呼你"
                      autoComplete="name"
                      maxLength={30}
                      aria-invalid={Boolean(fieldError("displayName", displayNameError))}
                    />
                    <span className="ds-field-hint" style={fieldError("displayName", displayNameError) ? { color: "var(--danger)" } : undefined}>
                      {fieldError("displayName", displayNameError) || "会显示在家庭成员和操作记录里"}
                    </span>
                  </div>
                )}

                <div className="ds-form-field">
                  <label className="ds-field-label" htmlFor="auth-password">密码</label>
                  <div className="relative">
                    <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      className="input input-icon input-icon-end"
                      value={password}
                      onChange={(event) => { setPassword(event.target.value); setError(""); }}
                      onBlur={() => setTouched((current) => ({ ...current, password: true }))}
                      placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                      autoComplete={setupRequired ? "new-password" : "current-password"}
                      maxLength={128}
                      aria-invalid={Boolean(fieldError("password", passwordError))}
                      aria-describedby="auth-password-hint"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="icon-action absolute right-1.5 top-1/2 -translate-y-1/2"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      title={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {setupRequired && <PasswordStrengthMeter password={password} />}
                  <span id="auth-password-hint" className="ds-field-hint" style={fieldError("password", passwordError) ? { color: "var(--danger)" } : undefined}>
                    {fieldError("password", passwordError) || (setupRequired ? "至少 8 位,混合大小写和数字更安全" : "输入你设置的密码")}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    记住我(30 天内免登录)
                  </label>
                  <div className="flex items-center gap-3">
                    {setupRequired ? (
                      <button
                        type="button"
                        onClick={() => { setPassword(generatePassword()); setTouched((current) => ({ ...current, password: true })); }}
                        className="text-xs font-bold"
                        style={{ color: "var(--primary)" }}
                      >
                        生成强密码
                      </button>
                    ) : (
                      <button type="button" onClick={openRecovery} className="text-xs font-bold" style={{ color: "var(--primary)" }}>
                        忘记密码?
                      </button>
                    )}
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl p-2.5 text-sm"
                    style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)" }}
                  >
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">{error}</span>
                  </div>
                )}

                <button type="submit" disabled={submitting} className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70">
                  {submitting ? <><Loader2 size={16} className="animate-spin" />{setupRequired ? "正在创建..." : "正在登录..." }</> : setupRequired ? "创建账号并进入" : "登录"}
                </button>

                {!setupRequired && (
                  <p className="mb-0 mt-1 text-center text-xs muted">
                    忘记密码?用一次性恢复码自助重置,或联系家庭管理员在设置里为你重置。
                  </p>
                )}
              </form>
            </>
          )}

          {view === "recovery" && (
            <>
              <button type="button" onClick={backToLogin} className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--muted)" }}>
                <ArrowLeft size={14} />返回登录
              </button>

              <div className="mb-6">
                <h1 className="mb-0 text-2xl font-black tracking-tight">找回密码</h1>
                <p className="mb-0 mt-2 text-sm muted">
                  用账号的一次性恢复码重置密码。恢复码可以在「设置 → 账号与家庭成员」里生成。
                </p>
              </div>

              <form onSubmit={submitRecovery} noValidate className="space-y-4">
                <div className="ds-form-field">
                  <label className="ds-field-label" htmlFor="recovery-username">用户名</label>
                  <div className="relative">
                    <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
                    <input
                      id="recovery-username"
                      className="input input-icon"
                      value={recoveryUsername}
                      onChange={(event) => { setRecoveryUsername(event.target.value.toLowerCase()); setRecoveryError(""); }}
                      onBlur={() => setRecoveryTouched((current) => ({ ...current, username: true }))}
                      placeholder="例如:xiaoming"
                      autoComplete="username"
                      autoFocus
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={32}
                      aria-invalid={Boolean(recoveryFieldError("username", recoveryUsernameError))}
                      aria-describedby="recovery-username-hint"
                    />
                  </div>
                  <span id="recovery-username-hint" className="ds-field-hint" style={recoveryFieldError("username", recoveryUsernameError) ? { color: "var(--danger)" } : undefined}>
                    {recoveryFieldError("username", recoveryUsernameError) || "要重置密码的账号"}
                  </span>
                </div>

                <div className="ds-form-field">
                  <label className="ds-field-label" htmlFor="recovery-code">恢复码</label>
                  <div className="relative">
                    <ShieldCheck size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
                    <input
                      id="recovery-code"
                      className="input input-icon font-mono tracking-[.14em]"
                      value={recoveryCode}
                      onChange={(event) => { setRecoveryCode(displayRecoveryCode(event.target.value)); setRecoveryError(""); }}
                      onBlur={() => setRecoveryTouched((current) => ({ ...current, code: true }))}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      autoComplete="one-time-code"
                      inputMode="text"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={RECOVERY_CODE_LENGTH + 3}
                      aria-invalid={Boolean(recoveryFieldError("code", recoveryCodeError))}
                      aria-describedby="recovery-code-hint"
                    />
                  </div>
                  <span id="recovery-code-hint" className="ds-field-hint" style={recoveryFieldError("code", recoveryCodeError) ? { color: "var(--danger)" } : undefined}>
                    {recoveryFieldError("code", recoveryCodeError) || `${RECOVERY_CODE_LENGTH} 位字符,不区分大小写,可整段粘贴`}
                  </span>
                </div>

                <div className="ds-form-field">
                  <label className="ds-field-label" htmlFor="recovery-password">新密码</label>
                  <div className="relative">
                    <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
                    <input
                      id="recovery-password"
                      type={showRecoveryPassword ? "text" : "password"}
                      className="input input-icon input-icon-end"
                      value={recoveryPassword}
                      onChange={(event) => { setRecoveryPassword(event.target.value); setRecoveryError(""); }}
                      onBlur={() => setRecoveryTouched((current) => ({ ...current, password: true }))}
                      placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                      autoComplete="new-password"
                      maxLength={PASSWORD_MAX_LENGTH}
                      aria-invalid={Boolean(recoveryFieldError("password", recoveryPasswordError))}
                      aria-describedby="recovery-password-hint"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRecoveryPassword((current) => !current)}
                      className="icon-action absolute right-1.5 top-1/2 -translate-y-1/2"
                      aria-label={showRecoveryPassword ? "隐藏新密码" : "显示新密码"}
                      title={showRecoveryPassword ? "隐藏新密码" : "显示新密码"}
                    >
                      {showRecoveryPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <PasswordStrengthMeter password={recoveryPassword} />
                  <span id="recovery-password-hint" className="ds-field-hint" style={recoveryFieldError("password", recoveryPasswordError) ? { color: "var(--danger)" } : undefined}>
                    {recoveryFieldError("password", recoveryPasswordError) || "至少 8 位,混合大小写和数字更安全"}
                  </span>
                </div>

                <div className="ds-form-field">
                  <label className="ds-field-label" htmlFor="recovery-confirm">确认新密码</label>
                  <div className="relative">
                    <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
                    <input
                      id="recovery-confirm"
                      type={showRecoveryConfirm ? "text" : "password"}
                      className="input input-icon input-icon-end"
                      value={recoveryConfirm}
                      onChange={(event) => { setRecoveryConfirm(event.target.value); setRecoveryError(""); }}
                      onBlur={() => setRecoveryTouched((current) => ({ ...current, confirm: true }))}
                      placeholder="再输入一次新密码"
                      autoComplete="new-password"
                      maxLength={PASSWORD_MAX_LENGTH}
                      aria-invalid={Boolean(recoveryFieldError("confirm", recoveryConfirmError))}
                      aria-describedby="recovery-confirm-hint"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRecoveryConfirm((current) => !current)}
                      className="icon-action absolute right-1.5 top-1/2 -translate-y-1/2"
                      aria-label={showRecoveryConfirm ? "隐藏确认密码" : "显示确认密码"}
                      title={showRecoveryConfirm ? "隐藏确认密码" : "显示确认密码"}
                    >
                      {showRecoveryConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span id="recovery-confirm-hint" className="ds-field-hint" style={recoveryFieldError("confirm", recoveryConfirmError) ? { color: "var(--danger)" } : undefined}>
                    {recoveryFieldError("confirm", recoveryConfirmError) || "两次输入要完全一致"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => { setRecoveryPassword(generatePassword()); setShowRecoveryPassword(true); setRecoveryTouched((current) => ({ ...current, password: true })); }}
                    className="text-xs font-bold"
                    style={{ color: "var(--primary)" }}
                  >
                    生成强密码
                  </button>
                  <span className="text-[11px] muted">重置后所有设备都需要重新登录</span>
                </div>

                {recoveryError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl p-2.5 text-sm"
                    style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)" }}
                  >
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">{recoveryError}</span>
                  </div>
                )}

                <button type="submit" disabled={recoverySubmitting} className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70">
                  {recoverySubmitting ? <><Loader2 size={16} className="animate-spin" />正在重置...</> : "重置密码"}
                </button>
              </form>
            </>
          )}

          {view === "recovery-done" && (
            <>
              <div className="mb-5 flex items-center gap-2.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" }}>
                  <Check size={20} />
                </span>
                <div>
                  <h1 className="mb-0 text-xl font-black tracking-tight">密码已重置</h1>
                  <p className="mb-0 mt-0.5 text-xs muted">账号 {recoveryUsername} 的密码已更新,所有设备已退出登录。</p>
                </div>
              </div>

              <div
                className="rounded-2xl p-3.5"
                style={{ background: "color-mix(in srgb, var(--primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--primary)" }}>新的恢复码</span>
                  <button type="button" onClick={copyRecoveryCode} className="btn-ghost ds-button-sm flex items-center gap-1.5">
                    {copyState === "copied" ? <><Check size={13} />已复制</> : <><Copy size={13} />复制</>}
                  </button>
                </div>
                <p className="mb-0 mt-2 break-all font-mono text-lg font-black tracking-[.14em]" style={{ color: "var(--foreground)" }}>
                  {doneCode || "(未返回新恢复码,请联系家庭管理员)"}
                </p>
              </div>

              <p className="mb-0 mt-3 flex items-start gap-1.5 text-xs" style={{ color: "var(--danger)" }}>
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                <span>这是唯一一次展示,请立刻抄写或保存。下次重置后旧码会失效。</span>
              </p>

              {copyState === "failed" && (
                <p className="mb-0 mt-2 text-xs" role="status" style={{ color: "var(--warning)" }}>
                  当前环境不支持一键复制,请手动选中上面的恢复码保存。
                </p>
              )}
              {copyState === "copied" && (
                <p className="mb-0 mt-2 text-xs" role="status" style={{ color: "var(--success)" }}>
                  已复制到剪贴板,记得存到安全的地方。
                </p>
              )}

              <p className="mb-0 mt-3 text-xs muted">
                之后可以在「设置 → 账号与家庭成员」里重新生成恢复码。
              </p>

              <button
                type="button"
                onClick={() => { setUsername(recoveryUsername); setPassword(""); setError(""); setSubmitted(false); backToLogin(); }}
                className="btn-primary mt-5 flex w-full items-center justify-center gap-2"
              >
                <ArrowLeft size={16} />用新用户名登录
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** 密码强度指示,复用登录/创建管理员页的既有样式。 */
function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = passwordStrength(password);
  const empty = password.length === 0;
  const color = empty
    ? "var(--muted)"
    : strength.tone === "danger" ? "var(--danger)" : strength.tone === "warning" ? "var(--warning)" : "var(--success)";
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: index < strength.score ? color : "var(--border)" }}
          />
        ))}
      </div>
      <span className="shrink-0 text-[11px] font-bold" style={{ color }}>
        {empty ? "密码强度" : strength.label}
      </span>
    </div>
  );
}

/** Decorative line art for the brand panel: a home shelf drawn with CSS/SVG only. */
function HomeArtwork() {
  return (
    <svg className="auth-artwork" viewBox="0 0 320 220" fill="none" aria-hidden="true">
      <path d="M40 190h240" stroke="var(--brand-line)" strokeWidth="2" strokeLinecap="round" />
      <path d="M70 190v-52h54v52" stroke="var(--brand-line)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M140 190v-76h60v76" stroke="var(--brand-accent)" strokeWidth="2" strokeLinejoin="round" opacity="0.55" />
      <path d="M218 190v-40h44v40" stroke="var(--brand-line)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="82" y="158" width="30" height="20" rx="4" stroke="var(--brand-line)" strokeWidth="2" />
      <rect x="152" y="140" width="36" height="26" rx="4" stroke="var(--brand-accent)" strokeWidth="2" opacity="0.55" />
      <rect x="228" y="164" width="24" height="16" rx="4" stroke="var(--brand-line)" strokeWidth="2" />
      <path d="M74 128l26-24 26 24" stroke="var(--brand-line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="100" cy="112" r="4" fill="var(--brand-accent)" opacity="0.6" />
      <circle cx="170" cy="104" r="5" fill="var(--brand-accent)" opacity="0.4" />
      <circle cx="240" cy="140" r="3.5" fill="var(--brand-line)" />
    </svg>
  );
}

export type { AuthUser };
