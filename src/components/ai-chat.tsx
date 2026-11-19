"use client";

import { FileText, ImagePlus, LoaderCircle, Paperclip, Search, Send, Trash2, Bot, X, Plus, Check, ListTree } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useEscapeClose } from "@/lib/use-escape-close";
import { useConfirm } from "@/components/confirm-dialog";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy, RotateCcw } from "lucide-react";

type Attachment = { kind: "image" | "text" | "file"; name: string; dataUrl?: string; url?: string; text?: string };
type ItemDraft = { name: string; category: string; type: "DURABLE" | "CONSUMABLE"; quantity: number; unit: string; locationName?: string; expiryDate?: string | null; notes?: string };
type ChatMessage = { role: "user" | "assistant"; content: string; attachments?: Attachment[]; itemDraft?: ItemDraft };
const historyKey = "home-inventory-assistant-history-v2";
/** 第一次打开时给几个能直接用的问法,省得对着空输入框发愣。 */
const QUICK_PROMPTS = [
  "家里有什么快过期的?",
  "哪些东西该补货了?",
  "这个月花了多少钱?",
  "冰箱里该放哪些东西?",
] as const;
const welcome: ChatMessage = { role: "assistant", content: "你好，我是归物助手。我可以帮你查找物品位置、库存数量、临期物品和待采购清单，也可以结合联网搜索查价格和资料。" };

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (file.type.startsWith("image/")) {
      if (file.size > 12 * 1024 * 1024) return reject(new Error("图片不能超过 12MB，请换一张更小的图片后再试"));
      const reader = new FileReader(); reader.onload = () => resolve({ kind: "image", name: file.name, dataUrl: String(reader.result) }); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); return;
    }
    const textLike = file.type.startsWith("text/") || /\.(csv|json|md|log|xml|yaml|yml)$/i.test(file.name);
    if (!textLike) return resolve({ kind: "file", name: file.name, text: `文件“${file.name}”已上传，但当前仅能直接读取图片和文本文件。` });
    const reader = new FileReader(); reader.onload = () => resolve({ kind: "text", name: file.name, text: String(reader.result).slice(0, 200000) }); reader.onerror = () => reject(new Error("文件读取失败")); reader.readAsText(file);
  });
}

/** 欢迎语只是打开面板时的界面文案,不该写进聊天历史 —— 否则每同步一次就多一条。 */
function isGreeting(message: ChatMessage) {
  return message.role === "assistant" && message.content === welcome.content;
}

// 归一化:去掉空附件与空草稿,避免「attachments: []」与「没有该字段」被当成两条不同消息。
function normalizeForCompare(message: ChatMessage) {
  return {
    role: message.role,
    content: message.content,
    ...(message.itemDraft ? { itemDraft: message.itemDraft } : {}),
    ...(message.attachments && message.attachments.length ? { attachments: message.attachments.map(({ kind, name: attachmentName, url, text: attachmentText }) => ({ kind, name: attachmentName, url, text: attachmentText })) } : {}),
  };
}
function persistable(messages: ChatMessage[]) { return messages.filter((message) => !isGreeting(message)).slice(-40).map(normalizeForCompare); }
function equals(a: ChatMessage[], b: ChatMessage[]) { return JSON.stringify(persistable(a)) === JSON.stringify(persistable(b)); }
function mergeMessages(remote: ChatMessage[], local: ChatMessage[]) {
  const seen = new Set<string>();
  return [...remote, ...local].filter((message) => { const key = JSON.stringify(persistable([message])[0]); if (seen.has(key)) return false; seen.add(key); return true; }).slice(-40);
}

export function AiChat({ onClose, items = [], onOpenItem, seed }: { onClose: () => void; items?: Array<{ id: string; name: string }>; onOpenItem?: (id: string) => void; seed?: string | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [input, setInput] = useState(seed ?? ""); const [attachments, setAttachments] = useState<Attachment[]>([]); const [loading, setLoading] = useState(false); const [webSearch, setWebSearch] = useState(false); const [ready, setReady] = useState(false); const [savingItem, setSavingItem] = useState<number | null>(null); const [recordedItems, setRecordedItems] = useState<Set<number>>(() => new Set());
  const fileInput = useRef<HTMLInputElement>(null); const scrollRef = useRef<HTMLDivElement>(null); const messagesRef = useRef(messages); const savingHistory = useRef(false); const historyUpdatedAt = useRef<string | null>(null);
  useEscapeClose(onClose);
  const askConfirm = useConfirm();
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { let cancelled = false; const load = async () => { try { const response = await fetch("/api/ai/chat/history", { cache: "no-store" }); const body = await response.json(); if (!cancelled && response.ok && Array.isArray(body.messages) && body.messages.length) { historyUpdatedAt.current = body.updatedAt || null; setMessages(body.messages); } else if (!cancelled) { const local = JSON.parse(localStorage.getItem(historyKey) || "null"); if (Array.isArray(local) && local.length) setMessages(local); } } catch { try { const local = JSON.parse(localStorage.getItem(historyKey) || "null"); if (!cancelled && Array.isArray(local) && local.length) setMessages(local); } catch { /* Ignore malformed local history. */ } } finally { if (!cancelled) setReady(true); } }; void load(); return () => { cancelled = true; }; }, []);
  useEffect(() => { if (!ready) return; localStorage.setItem(historyKey, JSON.stringify(persistable(messages))); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); const timer = window.setTimeout(async () => { if (savingHistory.current) return; savingHistory.current = true; try { const response = await fetch("/api/ai/chat/history", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: persistable(messages), expectedUpdatedAt: historyUpdatedAt.current }) }); const body = await response.json().catch(() => ({})); if (response.status === 409 && Array.isArray(body.messages)) { const merged = mergeMessages(body.messages, messagesRef.current); historyUpdatedAt.current = body.updatedAt || null; setMessages(merged); } else if (response.ok) historyUpdatedAt.current = body.updatedAt || new Date().toISOString(); } finally { savingHistory.current = false; } }, 450); return () => window.clearTimeout(timer); }, [messages, ready]);
  useEffect(() => {
    if (!ready) return;
    // Poll for changes made on another device, but only while this tab is
    // visible: an assistant left open in a background tab should not keep
    // waking the server every 12 seconds.
    let timer = 0;
    const poll = async () => {
      if (loading || savingHistory.current || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/ai/chat/history", { cache: "no-store" });
        const body = await response.json();
        if (response.ok && Array.isArray(body.messages) && body.messages.length && !equals(messagesRef.current, body.messages)) {
          historyUpdatedAt.current = body.updatedAt || null;
          setMessages(mergeMessages(body.messages, messagesRef.current));
        }
      } catch { /* Preserve current view offline. */ }
    };
    const start = () => { if (!timer) timer = window.setInterval(poll, 12000); };
    const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { void poll(); start(); } else { stop(); }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ready, loading]);
  const addFiles = async (files: FileList | File[]) => { const selected = Array.from(files).slice(0, 4); try { const next = await Promise.all(selected.map(readFile)); const stored = await Promise.all(next.map(async (attachment, index) => { if (attachment.kind !== "image") return attachment; const form = new FormData(); form.append("file", selected[index]); const response = await fetch("/api/upload", { method: "POST", body: form }); const body = await response.json(); if (!response.ok || !body.url) throw new Error(body.error || "图片保存失败"); return { ...attachment, url: body.url }; })); setAttachments((current) => [...current, ...stored].slice(0, 4)); } catch (error) { setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "附件读取失败" }]); } };
  const clearContext = async () => { if (!(await askConfirm("清空归物助手的聊天记录和上下文？", { title: "清空聊天记录", confirmLabel: "清空", tone: "danger" }))) return; setMessages([welcome]); setAttachments([]); setRecordedItems(new Set()); localStorage.removeItem(historyKey); };
  // 真正的提交逻辑(表单提交与 Enter 直发都走这里)。
  const submitQuestion = async (questionOverride?: string, options: { skipUserMessage?: boolean } = {}) => { const question = (questionOverride ?? input).trim(); if ((!question && !attachments.length) || loading) return; const userMessage: ChatMessage = { role: "user", content: question || "请识别图片中的物品，并整理成可直接录入家庭库存的信息。", attachments }; const next = options.skipUserMessage ? [...messagesRef.current] : [...messagesRef.current, userMessage]; setMessages(next); setInput(""); setAttachments([]); setLoading(true); try { const payload = next.map((message) => ({ ...message, attachments: message.attachments?.map((attachment) => attachment.kind === "image" && !attachment.dataUrl && attachment.url ? { ...attachment, dataUrl: attachment.url } : attachment) })); const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: payload, webSearch }) }); const result = await response.json(); setMessages((current) => [...current, { role: "assistant", content: response.ok ? result.answer : result.error || "AI 暂时无法回答", itemDraft: response.ok ? result.itemDraft : undefined }]); } catch { setMessages((current) => [...current, { role: "assistant", content: "网络连接失败，请稍后重试。" }]); } finally { setLoading(false); } };
  const ask = (event: FormEvent) => { event.preventDefault(); void submitQuestion(); };

  const createItem = async (draft: ItemDraft, messageIndex: number) => { if (savingItem !== null || recordedItems.has(messageIndex)) return; setSavingItem(messageIndex); try { const source = [...messagesRef.current.slice(0, messageIndex)].reverse().find((message) => message.role === "user" && message.attachments?.some((attachment) => attachment.kind === "image" && attachment.url)); const imageUrl = source?.attachments?.find((attachment) => attachment.kind === "image" && attachment.url)?.url || ""; const response = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, category: draft.category || "其他", type: draft.type, quantity: Math.max(0, Number(draft.quantity) || 1), minQuantity: 0, remainingPercent: 100, unit: draft.unit || "件", expiryDate: draft.type === "CONSUMABLE" && /^\d{4}-\d{2}-\d{2}$/.test(draft.expiryDate || "") ? draft.expiryDate : null, locationId: "", notes: draft.notes || "", imageUrl, aiSummary: "", aiStorageAdvice: "", aiUsageAdvice: "", aiReplenishmentAdvice: "" }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "录入失败"); setRecordedItems((current) => new Set(current).add(messageIndex)); setMessages((current) => [...current, { role: "assistant", content: `已录入“${result.name}”。${imageUrl ? "已将识别图片设为物品图片。" : "位置可以稍后再补充。"}${draft.locationName ? ` 建议再把位置补充为“${draft.locationName}”。` : ""}` }]); } catch (error) { setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "录入失败，请稍后重试。" }]); } finally { setSavingItem(null); } };
  // 生成过程中关掉面板会丢掉回答,但用户消息已经入库 —— 重新打开时补一个「重新提问」入口,
  // 否则看起来像助手没理你。不自动重发,避免用户没注意就被扣一次调用。
  const pendingQuestion = !loading && messages.length > 1 && messages[messages.length - 1].role === "user"
    ? messages[messages.length - 1].content
    : null;
  const retryPending = () => {
    if (!pendingQuestion || loading) return;
    // 直接把这条问题重新发出去,而不是只填进输入框让用户再点一次发送。
    setInput("");
    void submitQuestion(pendingQuestion);
  };

  const copyReply = (content: string) => { void copyToClipboard(content); };
  // 本次对话问过什么。长对话里翻回去很费劲,这里给一份可点的目录(不额外调用模型)。
  const [showOutline, setShowOutline] = useState(false);
  const askedQuestions = messages.flatMap((message, index) => (message.role === "user" && message.content.trim() ? [{ index, text: message.content.trim() }] : []));
  const jumpToMessage = (index: number) => {
    setShowOutline(false);
    // 两个坑都在这里踩过:
    // 1) 助手面板是 position:fixed,scrollIntoView 在它内部完全不生效(滚动位置纹丝不动);
    // 2) 收起目录会引起重渲染,若在同一帧里滚动,布局变化会把滚动直接取消。
    // 所以:等两帧(确保提交完成)之后,用瞬时滚动显式设置滚动容器的位置。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const target = document.getElementById(`chat-message-${index}`);
      if (!scroller || !target) return;
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta - scroller.clientHeight / 2 + target.clientHeight / 2), behavior: "auto" });
    }));
  };
  // 重新生成:去掉最后一条回答,用同一条问题再问一次(不动用户消息,避免重复入库)。
  const regenerate = async () => {
    if (loading) return;
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    // 去掉最后一条回答;问题本身已经存在,不能再追加一次(否则对话里会重复同一个提问)。
    const trimmed = messages[messages.length - 1]?.role === "assistant" ? messages.slice(0, -1) : messages;
    setMessages(trimmed);
    messagesRef.current = trimmed;
    await submitQuestion(lastUser.content, { skipUserMessage: true });
  };

  const paste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addFiles(files); } };
  return <><div aria-hidden="true" className="fixed inset-0 z-[95] bg-black/35 backdrop-blur-sm" onMouseDown={onClose} /><div role="dialog" aria-label="归物助手" className="ai-chat-panel fixed bottom-4 right-4 z-[100] flex h-[min(720px,calc(100vh-32px))] w-[min(460px,calc(100vw-32px))] flex-col overflow-hidden rounded-3xl border shadow-2xl" style={{ background: "var(--surface-solid)", borderColor: "var(--hairline)" }}><header className="flex items-center gap-3 border-b p-4" style={{ borderColor: "var(--hairline)" }}><div className="hidden size-10 shrink-0 place-items-center rounded-2xl sm:grid" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Bot size={20} /></div><div className="min-w-0 flex-1"><h2 className="m-0 truncate whitespace-nowrap text-base font-black leading-snug sm:text-lg">归物助手</h2><p className="mb-0 mt-1 truncate whitespace-nowrap text-xs muted">库存问答、图片识别和联网资料查询</p></div>{askedQuestions.length >= 2 && (
  <button
    type="button"
    onClick={() => setShowOutline((value) => !value)}
    className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-bold md:min-h-10"
    style={showOutline ? { background: "var(--primary-soft)", color: "var(--primary)" } : { background: "var(--surface-soft)" }}
    aria-expanded={showOutline}
    aria-label={`${showOutline ? "隐藏" : "显示"}本次对话要点`}
  >
    <ListTree size={14} />
    <span className="hidden sm:inline">要点</span>
    <span>{askedQuestions.length}</span>
  </button>
)}
<button onClick={onClose} className="icon-action size-11 min-h-11" aria-label="关闭归物助手" title="关闭"><X size={18} /></button></header>{showOutline && (
  <div className="border-b p-3" style={{ borderColor: "var(--hairline)", background: "var(--surface-soft)" }}>
    <div className="mb-2 text-xs font-bold muted">本次对话问过</div>
    <ol className="m-0 max-h-40 list-none space-y-1 overflow-y-auto p-0">
      {askedQuestions.map((entry, order) => (
        <li key={entry.index}>
          <button
            type="button"
            onClick={() => jumpToMessage(entry.index)}
            className="flex w-full min-h-9 items-start gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-solid)]"
          >
            <span className="shrink-0 font-bold muted">{order + 1}.</span>
            <span className="min-w-0 truncate">{entry.text}</span>
          </button>
        </li>
      ))}
    </ol>
  </div>
)}
<div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.map((message, index) => <div id={`chat-message-${index}`} key={`${message.role}-${index}`} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}><div className={`max-w-[90%] rounded-2xl px-3 py-2.5 text-sm leading-6 ${message.role === "user" ? "whitespace-pre-wrap text-[var(--on-primary)]" : "whitespace-pre-wrap"}`} style={message.role === "user" ? { background: "var(--primary)" } : { background: "var(--surface-soft)" }}>{message.attachments?.map((attachment, attachmentIndex) => <AttachmentPreview key={`${attachment.name}-${attachmentIndex}`} attachment={attachment} tone={message.role === "user" ? "dark" : "light"} />)}{plainChatText(message.content)}</div>{message.role === "assistant" && (<>
  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
    {mentionedItems(message.content, items).map((entry) => (
      <button
        key={entry.id}
        type="button"
        onClick={() => onOpenItem?.(entry.id)}
        className="min-h-11 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors md:min-h-8"
        style={{ background: "var(--surface-soft)", color: "var(--primary)" }}
        aria-label={`打开「${entry.name}」`}
      >
        {entry.name}
      </button>
    ))}
  </div>
  <div className="mt-1 flex items-center gap-1">
    <button type="button" onClick={() => copyReply(message.content)} className="grid size-11 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-soft)] md:size-8" aria-label="复制这条回答" title="复制"><Copy size={13} /></button>
    {index === messages.length - 1 && !loading && (
      <button type="button" onClick={() => { void regenerate(); }} className="grid size-11 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-soft)] md:size-8" aria-label="重新生成这条回答" title="重新生成"><RotateCcw size={13} /></button>
    )}
  </div>
</>)}
{message.role === "assistant" && message.itemDraft?.name && <button type="button" onClick={() => void createItem(message.itemDraft!, index)} disabled={savingItem !== null || recordedItems.has(index)} className="btn-primary mt-2 inline-flex h-9 min-h-9 items-center gap-1.5 py-0 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60"><Plus size={15} />{savingItem === index ? "正在录入…" : recordedItems.has(index) ? <><Check size={15} />已录入</> : `录入“${message.itemDraft.name}”`}</button>}{index === messages.length - 1 && !loading && <button type="button" onClick={() => void clearContext()} className="mt-2 grid size-11 place-items-center rounded-full text-[var(--muted)] opacity-65 transition hover:bg-[var(--surface-soft)] hover:text-red-500 sm:size-10" aria-label="清空上下文" title="清空上下文"><Trash2 size={13} /></button>}</div>)}{loading && <div className="flex items-center gap-2 text-xs muted"><LoaderCircle className="animate-spin" size={14} />归物助手正在整理资料…</div>}</div><div className="border-t p-3" style={{ borderColor: "var(--border)" }}>{attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{attachments.map((attachment, index) => <div key={`${attachment.name}-${index}`} className="relative"><AttachmentPreview attachment={attachment} compact /><button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="absolute -right-2 -top-2 grid size-11 place-items-center rounded-full bg-black/70 text-white sm:size-10" aria-label={`移除 ${attachment.name}`}><X size={12} /></button></div>)}</div>}{pendingQuestion && !input && (
  <div className="mb-2 flex items-center gap-2 rounded-2xl px-3 py-2 text-xs leading-5" style={{ background: "var(--warning-soft, #fff4dc)", color: "#8a571c" }}>
    <span className="min-w-0 flex-1">上一个问题还没回答完(可能是关闭面板时中断了)。</span>
    <button type="button" onClick={retryPending} className="min-h-9 shrink-0 rounded-full px-2.5 font-bold" style={{ background: "#fff" }}>重新提问</button>
  </div>
)}
{messages.length <= 1 && !input && !attachments.length && (
  <div className="mb-2 flex flex-wrap gap-1.5">
    {QUICK_PROMPTS.map((prompt) => (
      <button
        key={prompt}
        type="button"
        onClick={() => setInput(prompt)}
        className="min-h-11 rounded-full px-3 py-1.5 text-xs font-bold transition-colors md:min-h-8"
        style={{ background: "var(--surface-soft)", color: "var(--primary)" }}
      >
        {prompt}
      </button>
    ))}
  </div>
)}
<form onSubmit={ask} className="flex items-end gap-1.5 sm:gap-2"><button type="button" onClick={() => fileInput.current?.click()} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0" aria-label="上传图片或文件" title="上传图片或文件"><Paperclip size={17} /></button><input ref={fileInput} type="file" multiple accept="image/*,.txt,.csv,.json,.md,.log,.xml,.yaml,.yml" className="hidden" onChange={(event) => { void addFiles(event.target.files || []); event.currentTarget.value = ""; }} /><textarea className="ai-chat-input input min-h-11 min-w-0 flex-1 resize-none px-2.5 py-2.5 text-sm sm:px-3" rows={1} value={input} onPaste={paste} onChange={(event) => setInput(event.target.value)} placeholder="问点什么…" aria-label="输入问题"
 onKeyDown={(event) => {
   // 中文输入法组字过程中的 Enter 是「选词」,不能当成发送。
   if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
   event.preventDefault();
   void submitQuestion();
 }} /><button type="button" onClick={() => setWebSearch((value) => !value)} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0" style={webSearch ? { background: "var(--primary-soft)", color: "var(--primary)" } : undefined} aria-label="联网搜索" title={webSearch ? "已开启联网搜索" : "开启联网搜索"}><Search size={17} /></button><button className="btn-primary grid size-11 min-h-11 shrink-0 place-items-center p-0 disabled:opacity-50" aria-label="发送问题" disabled={loading || (!input.trim() && !attachments.length)}><Send size={17} /></button></form><div className="mt-1 text-xs muted">Enter 发送,Shift + Enter 换行。聊天记录会自动同步到你的其他已登录设备；上传图片后会优先识别为待录入物品。</div></div></div></>;
}

/**
 * 从一段回答里找出「提到的物品」。
 * 直接用正文做正则内联链接太脆(容易被标点、空格打断),改成匹配后列成芯片,点一下就能看详情。
 */
function mentionedItems(content: string, items: Array<{ id: string; name: string }>) {
  const matched: Array<{ id: string; name: string }> = [];
  for (const item of items) {
    if (item.name.length < 2) continue;
    if (!content.includes(item.name)) continue;
    if (matched.some((entry) => entry.name === item.name)) continue;
    matched.push({ id: item.id, name: item.name });
    if (matched.length >= 4) break;
  }
  return matched;
}
function plainChatText(content: string) { return content.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1"); }
{/* eslint-disable-next-line @next/next/no-img-element -- 用户上传的图片(data URL 或任意 OSS 地址),next/image 无法处理 */}
function AttachmentPreview({ attachment, tone = "light", compact = false }: { attachment: Attachment; tone?: "light" | "dark"; compact?: boolean }) { const source = attachment.dataUrl || attachment.url; if (attachment.kind === "image" && source) return <div className={`mb-2 overflow-hidden rounded-xl ${compact ? "size-12 mb-0" : "max-w-[220px]"}`}><img src={source} alt={attachment.name} className={compact ? "size-full object-cover" : "block max-h-40 w-full object-cover"} /><div className={compact ? "sr-only" : `flex items-center gap-1.5 px-2 py-1 text-xs ${tone === "dark" ? "bg-black/15 text-white/85" : "bg-black/5 muted"}`}><ImagePlus size={12} />{attachment.name}</div></div>; return <div className={`mb-2 flex items-center gap-2 rounded-xl px-2 py-1 text-xs ${tone === "dark" ? "bg-black/10" : "bg-black/5"}`}><FileText size={13} />{attachment.name}</div>; }
