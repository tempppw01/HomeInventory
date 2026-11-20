"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bot, ChevronDown, CircleAlert, ImagePlus, Link2, MapPin, Package, Sparkles, Upload, Warehouse, X } from "lucide-react";
import {
  FormEvent, useEffect, useRef, useState,
} from "react";
import type { ReactNode } from "react";
import type { Item, ItemType, Location } from "@/types";
import { analyzeItem, AiAnalysis } from "@/components/ai-assistant-modal";
import {
  dailyUsageCost, isCountUnit, isLiquidConsumable, normalizeItemQuantity,
} from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { isMedicineCategory, suggestMedicineCategory } from "@/lib/categories";
import { itemInsight, STORAGE_LABEL } from "@/lib/item-insight";
import { Field } from "@/components/ui-kit";

import { useEscapeClose } from "@/lib/use-escape-close";
import { useConfirm } from "@/components/confirm-dialog";
import { DatePicker, DatePickerPreset } from "@/components/date-picker";
import { guessItemType, ItemTypeGuess } from "@/lib/item-type-guess";
import { ItemDraft, SavedItemTemplate, emptyDraft, compressImage, categories, units, itemTemplateStorageKey, dateInputValue, purchaseDatePresets, expiryDatePresets, purchaseAgeLabel, isMoneyInput, moneyValue, normalizedItemName, findCommonItemTemplate, request } from "../shared";
import { Modal, ImageLightbox } from "./modals";
import { localDateString } from "@/lib/local-date";
export function ItemModal({ locations, allItems, item, onClose, onSaved, aiAvailable = true, canConfigureAi = false, onConfigureAi }: { locations: Location[]; allItems: Item[]; item: Item | null; onClose: () => void; onSaved: () => void; aiAvailable?: boolean; canConfigureAi?: boolean; onConfigureAi?: () => void }) {
  // A second click could still fire before the `saving` state renders, so the
  // guard is a ref: the first call wins and the duplicate returns immediately.
  const submittingRef = useRef(false);
  const [draft, setDraft] = useState<ItemDraft>(() => item ? { name: item.name, category: item.category, type: item.type, quantity: item.quantity, minQuantity: item.minQuantity, remainingPercent: item.remainingPercent, unit: item.unit, price: item.price?.toString() ?? "", purchaseDate: item.purchaseDate?.slice(0, 10) ?? "", expiryDate: item.type === "CONSUMABLE" ? item.expiryDate?.slice(0, 10) ?? "" : "", locationId: item.locationId ?? "", notes: item.notes ?? "", imageUrl: item.imageUrl ?? "", aiSummary: item.aiSummary ?? "", aiStorageAdvice: item.aiStorageAdvice ?? "", aiUsageAdvice: item.aiUsageAdvice ?? "", aiReplenishmentAdvice: item.aiReplenishmentAdvice ?? "" } : emptyDraft);
  const [savedTemplates, setSavedTemplates] = useState<SavedItemTemplate[]>(() => {
    if (typeof window === "undefined" || item) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(itemTemplateStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((entry): entry is SavedItemTemplate => Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string")).slice(0, 8) : [];
    } catch { return []; }
  });
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [aiLoading, setAiLoading] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const [imagePreviewOpen, setImagePreviewOpen] = useState(false); const [error, setError] = useState(""); const [hint, setHint] = useState("");
  const [imageMode, setImageMode] = useState<"upload" | "link">(item?.imageUrl ? "link" : "upload");
  const [imageUrlDraft, setImageUrlDraft] = useState(item?.imageUrl ?? "");
  const [recordPurchase, setRecordPurchase] = useState(!item);
  const [purchaseStore, setPurchaseStore] = useState("");
  const [availableLocations, setAvailableLocations] = useState(locations);
  const [quickLocationOpen, setQuickLocationOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(() => Boolean(item?.imageUrl));
  // 数量用字符串承接:受控 number 会把「清空」立刻回填成 0,再输入就变成 02.5。
  const [qtyText, setQtyText] = useState(() => String(item ? item.quantity : emptyDraft.quantity));
  // 类型自动识别:只在「新建物品」且用户还没自己选过类型时介入,永远可一键改回。
  const [typeTouched, setTypeTouched] = useState(Boolean(item));
  const [typeGuess, setTypeGuess] = useState<ItemTypeGuess | null>(null);
  const normalizedName = normalizedItemName(draft.name);
  const commonTemplate = !item && normalizedName ? findCommonItemTemplate(draft.name) : null;
  const duplicates = !item && normalizedName ? allItems.filter((entry) => normalizedItemName(entry.name) === normalizedName) : [];
  const similarItems = !item && normalizedName.length >= 2 ? allItems.filter((entry) => {
    const entryName = normalizedItemName(entry.name);
    return entryName !== normalizedName && (entryName.includes(normalizedName) || normalizedName.includes(entryName));
  }).slice(0, 2) : [];
  const suggestedLocation = (() => {
    if (item || draft.locationId) return null;
    const sameName = allItems.filter((entry) => normalizedName && entry.name.trim().replace(/\s+/g, "").toLocaleLowerCase() === normalizedName && entry.location);
    const sameCategory = allItems.filter((entry) => entry.category === draft.category && entry.location);
    const locationByKeyword = commonTemplate ? availableLocations.find((location) => commonTemplate.locationKeywords.some((keyword) => location.name.toLocaleLowerCase().includes(keyword))) : null;
    return locationByKeyword ?? [...sameName, ...sameCategory].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.location ?? null;
  })();
  const applyTemplate = () => {
    if (!commonTemplate) return;
    setTypeTouched(true);
    setDraft((current) => ({
      ...current,
      category: current.category === "日用" ? (commonTemplate.category === "医药" ? suggestMedicineCategory(current.name) : commonTemplate.category) : current.category,
      type: current.type === "DURABLE" ? commonTemplate.type : current.type,
      locationId: !current.locationId && suggestedLocation ? suggestedLocation.id : current.locationId,
    }));
  };
  const applySavedTemplate = (template: SavedItemTemplate) => {
    setDraft((current) => ({
      ...current,
      name: template.name,
      category: template.category,
      type: template.type,
      quantity: normalizeItemQuantity(template.quantity, template.unit),
      minQuantity: template.minQuantity,
      remainingPercent: template.remainingPercent,
      unit: template.unit,
      expiryDate: template.type === "CONSUMABLE" ? template.expiryDate : "",
      locationId: locations.some((location) => location.id === template.locationId) ? template.locationId : "",
      notes: template.notes,
    }));
    setQtyText(String(normalizeItemQuantity(template.quantity, template.unit)));
    setSavedTemplates((current) => {
      const next = current.map((entry) => entry.id === template.id ? { ...entry, usedAt: Date.now() } : entry).sort((a, b) => b.usedAt - a.usedAt);
      localStorage.setItem(itemTemplateStorageKey, JSON.stringify(next));
      return next;
    });
  };
  const saveAsTemplate = () => {
    if (!draft.name.trim()) { setHint(""); setError("先填写物品名称,再保存模板"); return; }
    const template: SavedItemTemplate = { id: crypto.randomUUID(), name: draft.name.trim(), category: draft.category, type: draft.type, quantity: draft.quantity, minQuantity: draft.minQuantity, remainingPercent: draft.remainingPercent, unit: draft.unit, expiryDate: draft.expiryDate, locationId: draft.locationId, notes: draft.notes, usedAt: Date.now() };
    const next = [template, ...savedTemplates.filter((entry) => normalizedItemName(entry.name) !== normalizedItemName(template.name))].slice(0, 8);
    setSavedTemplates(next);
    localStorage.setItem(itemTemplateStorageKey, JSON.stringify(next));
    // 成功提示不要走 error 通道:那一栏是红字粉底,用户会以为自己操作失败了。
    setError("");
    setHint("模板已保存,下次录入时可以直接使用");
  };
  const set = (key: keyof ItemDraft, value: string | number) => setDraft((old) => ({ ...old, [key]: value }));
  const changeQuantityText = (raw: string) => {
    setQtyText(raw);
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return;
    set("quantity", Math.max(0, value));
  };
  const commitQuantityText = () => { const normalized = normalizeItemQuantity(draft.quantity, draft.unit); set("quantity", normalized); setQtyText(String(normalized)); };
  // 用户手动选过单位之后,分类切换就不再自动改单位。
  const [unitTouched, setUnitTouched] = useState(false);
  // auto=true 表示这是「按建议自动套用」,不算用户手动改过 —— 否则第一条建议会把后续建议全锁死。
  const changeUnit = (unit: string, auto = false) => { if (!auto) setUnitTouched(true); const quantity = normalizeItemQuantity(draft.quantity, unit); setDraft((current) => ({ ...current, unit, quantity })); setQtyText(String(quantity)); };
  // 手动点类型 = 关掉自动识别,后续不再覆盖用户的选择。
  const chooseItemType = (type: ItemType) => {
    setTypeTouched(true);
    setTypeGuess(null);
    setDraft((current) => ({ ...current, type, expiryDate: type === "DURABLE" ? "" : current.expiryDate }));
  };
  useEffect(() => {
    if (item || typeTouched) return;
    const name = draft.name.trim();
    // 防抖 320ms:输入停下来再判断,不会每敲一个字就跳类型。
    const timer = window.setTimeout(() => {
      const guess = name.length >= 2 ? guessItemType({ name, category: draft.category, unit: draft.unit }) : null;
      if (!guess) { setTypeGuess(null); return; }
      setTypeGuess(guess);
      setDraft((current) => (current.type === guess.type ? current : { ...current, type: guess.type, expiryDate: guess.type === "DURABLE" ? "" : current.expiryDate }));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [draft.name, draft.category, draft.unit, item, typeTouched]);
  // 首次渲染的草稿快照,用来判断「填过东西」;用 state 而不是 ref,避免渲染期读 ref。
  const [initialDraft] = useState(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const askConfirm = useConfirm();
  const requestClose = async () => {
    if (!dirty || saving) { onClose(); return; }
    const confirmed = await askConfirm("已填写的内容会被丢弃,确定关闭吗?", { title: "放弃这次的填写?", confirmLabel: "放弃并关闭", cancelLabel: "继续填写" });
    if (confirmed) onClose();
  };
  const uploadImage = async (file?: File) => {
    if (!file) return;
    // 浏览器拿不到图时只抛英文底层报错(createImageBitmap / toBlob),
    // 所以先按类型和体积挡一道,再把剩余失败统一成中文提示。
    if (!file.type.startsWith("image/")) { setError("只支持 JPG / PNG / WebP / GIF 图片,这个文件不是图片"); return; }
    if (file.size > 20 * 1024 * 1024) { setError("图片超过 20MB,请先压缩或换一张更小的图"); return; }
    setUploading(true); setError("");
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("file", compressed);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "上传失败,请重试");
      set("imageUrl", result.url);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const raw = /decode|bitmap|blob|canvas|draw|image/i.test(message);
      setError(message && !raw ? message : "这个文件无法作为图片读取,请换一张 JPG / PNG / WebP / GIF 图片");
    } finally { setUploading(false); }
  };
  const applyImageUrl = () => { const value = imageUrlDraft.trim(); if (!value) { set("imageUrl", ""); setError(""); return; } try { const url = new URL(value); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(); set("imageUrl", value); setError(""); } catch { setError("请粘贴以 http:// 或 https:// 开头的图片地址"); } };
  const applyAi = (analysis: AiAnalysis) => setDraft((old) => { const type = analysis.type || old.type; const name = analysis.name || old.name; const rawCategory = analysis.category || old.category; const category = isMedicineCategory(rawCategory) ? (rawCategory === "医药" ? suggestMedicineCategory(name) : rawCategory) : rawCategory; return { ...old, name, category, type, unit: analysis.unit || old.unit, expiryDate: type === "DURABLE" ? "" : analysis.suggestedExpiryDate || old.expiryDate, notes: analysis.suggestedNotes || old.notes, aiSummary: analysis.summary || old.aiSummary, aiStorageAdvice: analysis.storageAdvice || old.aiStorageAdvice, aiUsageAdvice: analysis.usageAdvice || old.aiUsageAdvice, aiReplenishmentAdvice: analysis.replenishmentAdvice || old.aiReplenishmentAdvice }; });
  const runAi = async (action: "identify" | "shelf_life") => { setAiLoading(true); setError(""); try { const result = await analyzeItem({ action, imageUrl: draft.imageUrl || null, hint: draft.name, item: { name: draft.name, category: draft.category, type: draft.type, quantity: draft.quantity, minQuantity: draft.minQuantity, unit: draft.unit, purchaseDate: draft.purchaseDate || null, expiryDate: draft.expiryDate || null, notes: draft.notes || null } }); applyAi(result.analysis); if (action === "shelf_life") setMoreOpen(true); } catch (e) { setError(e instanceof Error ? e.message : "AI 分析失败"); } finally { setAiLoading(false); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    // 校验全部放在上锁之前:否则非法单价那条 return 会把锁永久留在 true,
    // 之后改对了也点不动保存(见 output/findings/entry.md P1-3)。
    const parsedPrice = draft.price === "" ? null : moneyValue(draft.price);
    if (draft.price !== "" && (parsedPrice === null || parsedPrice < 0)) { setError("请输入正确的购买单价,例如 19.90"); return; }
    const quantity = normalizeItemQuantity(draft.quantity, draft.unit);
    // 数量 0 的物品不会出现在任何列表里(列表只取 quantity > 0),
    // 保存成功却查无此物会被当成数据丢失,所以在提交前就拦住。
    if (!Number.isFinite(quantity) || quantity <= 0) { setError("数量至少填 1。如果东西已经用完,建议先加入采购清单,买到之后再录入。"); return; }
    setQtyText(String(quantity));
    submittingRef.current = true;
    setSaving(true); setError("");
    try {
      const payload = { ...(draft.type === "DURABLE" ? { ...draft, expiryDate: "" } : draft), quantity, price: parsedPrice };
      await request(item ? `/api/items/${item.id}` : "/api/items", { method: item ? "PATCH" : "POST", body: JSON.stringify({ ...payload, recordPurchase, purchaseStore }) });
    } catch (e) {
      // 只有失败才释锁:成功时弹层正在退场,提前释锁会让第二次点击重复提交(P1-2)。
      submittingRef.current = false;
      setSaving(false);
      setError(e instanceof Error ? e.message : "保存失败");
      return;
    }
    onSaved();
  };
  const dailyCostPreview = dailyUsageCost({ type: draft.type, price: draft.price === "" ? null : moneyValue(draft.price), purchaseDate: draft.purchaseDate || null });
  const draftAi = itemAiHighlights(draft);
  // 药品的有效期是最关键的一项,但「快速保存」路径会跳过它。这里在保存前给出就地引导。
  const isMedicine = isMedicineCategory(draft.category);
  // 后台规则引擎的即时预览:用户一边输入,界面一边给出「该不该冷藏 / 建议保质期」。
  const insight = itemInsight({ name: draft.name, category: draft.category, unit: draft.unit, type: draft.type });
  const applyShelfLife = () => {
    const days = insight.suggestedShelfLifeDays;
    if (!days) return;
    const base = draft.purchaseDate ? new Date(draft.purchaseDate) : new Date();
    const target = new Date(base.getTime() + days * 86400000);
    const iso = localDateString(target);
    set("expiryDate", iso);
    if (!draft.purchaseDate) set("purchaseDate", localDateString());
    setMoreOpen(true);
  };
  const missingExpiry = isMedicine && draft.type === "CONSUMABLE" && !draft.expiryDate;
  const focusExpiry = () => {
    setMoreOpen(true);
    // 展开是动画驱动的,等一帧再滚动定位到期日期。
    requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLElement>('[data-expiry-field] [data-date-picker-trigger], [data-expiry-field] button');
      trigger?.scrollIntoView({ block: "center", behavior: "smooth" });
      trigger?.focus?.();
    });
  };
  const addLocation = (location: Location) => { setAvailableLocations((current) => [...current, location]); set("locationId", location.id); setQuickLocationOpen(false); };
  return <><Modal title={item ? "编辑物品" : "录入新物品"} subtitle={item?.itemCode || "只填名称和数量也可以，其他信息稍后补充"} onClose={requestClose}><form onSubmit={submit} className="space-y-5">
    {!item && savedTemplates.length > 0 && <div className="-mt-1 overflow-x-auto pb-1"><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-bold muted">最近使用 / 我的模板</span><button type="button" onClick={() => { setSavedTemplates([]); localStorage.removeItem(itemTemplateStorageKey); }} className="text-xs muted hover:text-[var(--danger)]">清空</button></div><div className="flex min-w-max gap-2">{savedTemplates.slice().sort((a, b) => b.usedAt - a.usedAt).map((template) => <button key={template.id} type="button" onClick={() => applySavedTemplate(template)} className="rounded-xl border px-2.5 py-1.5 text-left text-xs font-bold transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]" style={{ borderColor: "var(--border)" }}><span className="block max-w-32 truncate">{template.name}</span><span className="mt-0.5 block text-xs font-normal muted">{template.category} · {template.unit}</span></button>)}</div></div>}
<div className="flex items-start gap-3">
      {draft.imageUrl ? (
        <button type="button" onClick={() => setImagePreviewOpen(true)} className="group relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-cover bg-center" style={{ backgroundImage: "url(" + draft.imageUrl + ")" }} aria-label="放大查看物品图片" title="点击放大查看">
          <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-xs font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">放大</span>
        </button>
      ) : (
        <div className="grid size-20 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)" }}>
          {uploading ? <Sparkles className="animate-pulse" size={22} /> : <ImagePlus className="muted" size={24} />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <label htmlFor="item-name" className="mb-1.5 block text-xs font-bold muted">物品名称 *</label>
        <input required id="item-name" maxLength={80} className="input" value={draft.name} onChange={(e) => { const next = e.target.value; set("name", next); if (!unitTouched) { const guess = itemInsight({ name: next, category: draft.category, unit: draft.unit, type: draft.type }); if (guess.suggestedUnit && guess.suggestedUnit !== draft.unit) changeUnit(guess.suggestedUnit, true); } }} placeholder="拍照让 AI 识别,或直接输入名称" />
        <div className="mt-2 flex gap-2">
          {aiAvailable ? <><button type="button" disabled={aiLoading || (!draft.name && !draft.imageUrl)} onClick={() => runAi("identify")} className="btn-ghost flex min-h-11 items-center md:min-h-10 gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"><Sparkles size={14} />{aiLoading ? "分析中..." : "AI 补全"}</button>
          {draft.type === "CONSUMABLE" && <button type="button" disabled={aiLoading || (!draft.name && !draft.imageUrl)} onClick={() => runAi("shelf_life")} className="btn-ghost flex min-h-11 items-center md:min-h-10 gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"><Bot size={14} />分析保质期</button>}</> : <button type="button" onClick={() => canConfigureAi && onConfigureAi?.()} className="btn-ghost flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs md:min-h-10"><Sparkles size={14} />{canConfigureAi ? "配置 AI 后可用" : "AI 未配置"}</button>}
        </div>
      </div>
    </div>

    <div className="flex rounded-2xl p-1" role="radiogroup" aria-label="物品类型" style={{ background: "var(--surface-soft)" }}>
      <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-colors" style={draft.type === "DURABLE" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>
        <input type="radio" className="sr-only" checked={draft.type === "DURABLE"} onChange={() => chooseItemType("DURABLE")} />
        <Package size={15} />耐用品
      </label>
      <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-colors" style={draft.type === "CONSUMABLE" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>
        <input type="radio" className="sr-only" checked={draft.type === "CONSUMABLE"} onChange={() => chooseItemType("CONSUMABLE")} />
        <Sparkles size={15} />消耗品
      </label>
    </div>

    {/* 后台自动判定:不需要用户点任何按钮,输入过程中就给出存放建议与建议保质期 */}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2 text-xs leading-5" style={{ background: "var(--surface-soft)" }}>
      <span className="flex items-center gap-1.5 font-bold">
        <Warehouse size={14} style={{ color: insight.storage === "ROOM" ? "var(--muted)" : "var(--primary)" }} />
        {STORAGE_LABEL[insight.storage]}
      </span>
      <span className="min-w-0 flex-1 muted">{insight.storageReason}</span>
      {insight.suggestedShelfLifeDays && !draft.expiryDate && (
        <button type="button" onClick={applyShelfLife} className="shrink-0 font-bold" style={{ color: "var(--primary)" }}>
          一键填有效期(约 {insight.suggestedShelfLifeDays} 天)
        </button>
      )}
    </div>

    {typeGuess && <div className="flex items-center gap-1.5 text-xs leading-5 muted"><Sparkles size={13} className="shrink-0" style={{ color: "var(--primary)" }} /><span className="min-w-0 flex-1">已按名称识别为{typeGuess.type === "CONSUMABLE" ? "消耗品" : "耐用品"} · {typeGuess.reason}</span><span className="shrink-0 opacity-75">点上方可改</span></div>}

    {(duplicates.length > 0 || similarItems.length > 0 || commonTemplate) && (
      <div className="rounded-2xl px-3 py-2.5 text-xs leading-5" style={{ background: "var(--warning-soft, #fff4dc)", color: "#8a571c" }}>
        {duplicates.length > 0 && <p className="m-0">已存在同名物品:{duplicates.slice(0, 2).map((dup) => dup.name).join("、")}{duplicates.length > 2 ? " 等" : ""}。保存后会合并数量。</p>}
        {duplicates.length === 0 && similarItems.length > 0 && <p className="m-0">找到相似物品:{similarItems.slice(0, 2).map((similar) => similar.name).join("、")}。</p>}
        {commonTemplate && <p className="m-0 mt-1">常用模板:{commonTemplate.category} · {commonTemplate.type === "CONSUMABLE" ? "消耗品" : "耐用品"}<button type="button" onClick={applyTemplate} className="ml-2 font-bold" style={{ color: "var(--primary)" }}>套用</button></p>}
      </div>
    )}
    {draftAi.hasHighlights && (
      <div className="rounded-2xl px-3 py-2.5 text-xs leading-5" style={{ background: "color-mix(in srgb, var(--primary) 6%, var(--surface-solid))", color: "var(--foreground)" }}>
        {[draftAi.summary, draftAi.storage, draftAi.usage, draftAi.replenishment].filter(Boolean).map((line) => <p key={String(line)} className="m-0">{line}</p>)}
      </div>
    )}

    <div className="overflow-hidden rounded-[20px] border" style={{ borderColor: "var(--hairline)", background: "var(--surface-solid)" }}>
      <FormRow label="分类">
        <select className="input" aria-label="分类" value={draft.category} onChange={(e) => { const next = e.target.value; set("category", next); if (unitTouched) return; const guess = itemInsight({ name: draft.name, category: next, unit: draft.unit, type: draft.type }); if (draft.unit === "件" && guess.suggestedUnit) changeUnit(guess.suggestedUnit, true); }}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
      </FormRow>
      <FormRow label="存放位置">
        <select className="input" aria-label="存放位置" value={draft.locationId} onChange={(e) => { if (e.target.value === "__new__") { setQuickLocationOpen(true); return; } set("locationId", e.target.value); }}>
          <option value="">未设置</option>
          {availableLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="__new__">＋ 新建存放位置…</option>
        </select>
        {suggestedLocation && <button type="button" onClick={() => set("locationId", suggestedLocation.id)} className="mt-1.5 flex max-w-full items-center gap-1 text-xs font-bold" style={{ color: "var(--primary)" }}><MapPin size={12} /><span className="truncate">建议放在 {suggestedLocation.name}</span></button>}
      </FormRow>
      <FormRow label="数量 *">
        <div className="flex gap-2">
          <input required type="number" min="0" step={isCountUnit(draft.unit) ? "1" : "0.1"} inputMode={isCountUnit(draft.unit) ? "numeric" : "decimal"} className="input min-w-0 flex-1" aria-label="数量" value={qtyText} onChange={(event) => changeQuantityText(event.target.value)} onBlur={commitQuantityText} aria-describedby="quantity-hint" />
          <select className="input w-24 shrink-0" aria-label="单位" value={draft.unit} onChange={(event) => changeUnit(event.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select>
        </div>
        <p id="quantity-hint" className="mb-0 mt-1.5 text-xs muted">{isCountUnit(draft.unit) ? "只能填整数(件 / 盒 / 台按整个计数)" : "可以填小数,例如 2.5"}</p>
      </FormRow>
      {isLiquidConsumable(draft) && (
        <FormRow label="剩余量">
          <RemainingLevelInline value={draft.remainingPercent} onChange={(next) => set("remainingPercent", next)} />
          <p className="mb-0 mt-1.5 text-xs muted">按整瓶记录库存;日常用量用这里的百分比表示。</p>
        </FormRow>
      )}
      <AccordionRow label="图片" summary={draft.imageUrl ? "已添加" : "未添加"} open={imageOpen} onToggle={() => setImageOpen((open) => !open)}><div className="px-3">
        <div className="mb-2 flex items-center gap-1">
          <button type="button" onClick={() => setImageMode("upload")} className="flex min-h-11 items-center md:min-h-10 gap-1.5 border-b-2 px-2 text-xs font-bold transition" style={{ borderColor: imageMode === "upload" ? "var(--primary)" : "transparent", color: imageMode === "upload" ? "var(--primary)" : "var(--muted)" }}><Upload size={14} />上传</button>
          <button type="button" onClick={() => setImageMode("link")} className="flex min-h-11 items-center md:min-h-10 gap-1.5 border-b-2 px-2 text-xs font-bold transition" style={{ borderColor: imageMode === "link" ? "var(--primary)" : "transparent", color: imageMode === "link" ? "var(--primary)" : "var(--muted)" }}><Link2 size={14} />链接</button>
          {draft.imageUrl && <button type="button" onClick={() => { set("imageUrl", ""); setImageUrlDraft(""); }} className="ml-auto min-h-11 text-xs font-bold" style={{ color: "var(--danger)" }}>移除图片</button>}
        </div>
        {imageMode === "upload" ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm font-bold" style={{ background: "var(--surface-soft)" }}>
            <ImagePlus size={16} style={{ color: "var(--primary)" }} />{uploading ? "正在压缩并上传..." : "选择图片上传"}
            <span className="ml-auto text-xs font-normal muted">选图后自动压缩</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} />
          </label>
        ) : (
          <div className="flex gap-2">
            <input className="input min-w-0 flex-1" aria-label="图片地址" value={imageUrlDraft} onChange={(event) => setImageUrlDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyImageUrl(); } }} onPaste={(event) => setImageUrlDraft(event.clipboardData.getData("text"))} placeholder="粘贴图片地址,例如 https://..." />
            <button type="button" onClick={applyImageUrl} className="btn-primary min-h-11 shrink-0 px-3 text-xs">应用</button>
          </div>
        )}
        </div>
      </AccordionRow>
      <AccordionRow label="更多信息" summary="价格、日期、提醒、备注" open={moreOpen} onToggle={() => setMoreOpen(!moreOpen)}>
        <FormRow label="购买单价">
          <input type="text" inputMode="decimal" autoComplete="off" className="input" aria-label="购买单价" value={draft.price} onChange={(event) => { const next = event.target.value; if (isMoneyInput(next)) set("price", next); }} onBlur={() => { const amount = moneyValue(draft.price); if (amount !== null) set("price", amount.toFixed(2)); }} placeholder="¥ 0.00" aria-describedby="price-hint" />
          <p id="price-hint" className="mb-0 mt-1.5 text-xs muted">支持键盘输入小数,例如 19.90{dailyCostPreview ? " · 当前日均成本 ¥" + dailyCostPreview.cost.toFixed(dailyCostPreview.cost >= 10 ? 0 : 2) + " / 天(已使用 " + dailyCostPreview.days + " 天)" : ""}</p>
        </FormRow>
        {draft.type === "CONSUMABLE" && (
          <FormRow label="低库存阈值">
            <input type="number" min="0" step="0.1" className="input" aria-label="低库存阈值" value={draft.minQuantity} onChange={(e) => set("minQuantity", Number(e.target.value))} />
          </FormRow>
        )}
        {draft.price !== "" && (
          <FormRow label="本月消费">
            <button type="button" onClick={() => setRecordPurchase(!recordPurchase)} aria-pressed={recordPurchase} className="flex min-h-11 w-full items-center justify-between rounded-xl px-2 text-sm" style={{ background: "var(--surface-soft)" }}>
              <span>记入本月消费记录</span>
              <span className="font-bold" style={{ color: recordPurchase ? "var(--success)" : "var(--muted)" }}>{recordPurchase ? "是" : "否"}</span>
            </button>
            {recordPurchase && <input className="input mt-2" aria-label="购买商店" value={purchaseStore} onChange={(e) => setPurchaseStore(e.target.value)} placeholder="购买商店(可选)" />}
          </FormRow>
        )}
        <DateField label="购入日期" value={draft.purchaseDate} onChange={(value) => set("purchaseDate", value)} presets={purchaseDatePresets()} max={dateInputValue()} relative={false} help={draft.purchaseDate ? purchaseAgeLabel(draft.purchaseDate) + "(日均成本按它计算)" : "按实际购买那天填,日均成本会用它计算。"} />
        {draft.type === "CONSUMABLE" && <div data-expiry-field><DateField label="到期日期" value={draft.expiryDate} onChange={(value) => set("expiryDate", value)} presets={expiryDatePresets()} min={draft.purchaseDate || dateInputValue()} help="留空表示不提醒保质期;过期后会出现在提醒中心。" /></div>}
        {draft.purchaseDate && draft.expiryDate && draft.expiryDate < draft.purchaseDate && (
          <p className="m-0 px-3 py-2.5 text-xs leading-5" style={{ background: "var(--warning-soft, #fff4dc)", color: "#8a571c" }}>到期日期({draft.expiryDate})早于购入日期({draft.purchaseDate}),保存后会立刻算作过期,建议改一下。</p>
        )}
        <FormRow label="备注">
          <textarea className="input min-h-20 resize-none" aria-label="备注" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="规格、保修、使用提示..." />
        </FormRow>
      </AccordionRow>
    </div>
    {missingExpiry && (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 text-xs leading-5" style={{ background: "var(--warning-soft, #fff4dc)", color: "#8a571c" }}>
        <CircleAlert size={14} className="shrink-0" />
        <span className="min-w-0 flex-1">这是药品,填上有效期后会在到期前提醒你。</span>
        <button type="button" onClick={focusExpiry} className="min-h-10 shrink-0 font-bold underline">填写有效期</button>
      </div>
    )}
    {error && <p className="m-0 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}
    {hint && !error && <p className="m-0 rounded-xl p-2.5 text-sm font-bold" style={{ background: "var(--success-soft)", color: "var(--success)" }}>{hint}</p>}<div className="sticky bottom-0 -mx-5 flex gap-2.5 border-t bg-[var(--surface-solid)] px-5 pb-1 pt-3 sm:-mx-6 sm:px-6" style={{ borderColor: "var(--hairline)" }}><button type="button" onClick={requestClose} className="btn-ghost min-h-11 flex-1">取消</button>{!item && <button type="button" onClick={saveAsTemplate} className="btn-ghost min-h-11 shrink-0 px-3" title="保存名称、分类、单位和常用设置">存为模板</button>}<button disabled={saving || uploading || aiLoading} className="btn-primary min-h-11 flex-1 disabled:opacity-60">{saving ? "保存中…" : item ? "保存修改" : "快速保存"}</button></div>
  </form></Modal><AnimatePresence>{imagePreviewOpen && draft.imageUrl && <ImageLightbox src={draft.imageUrl} alt={draft.name || "物品图片"} onClose={() => setImagePreviewOpen(false)} />}</AnimatePresence><AnimatePresence>{quickLocationOpen && <QuickLocationDialog onClose={() => setQuickLocationOpen(false)} onCreated={addLocation} />}</AnimatePresence></>;
}

// 行式表单:标签在左、控件在右,行与行之间只用发丝线,不再给每个字段套框。
function FormRow({ label, children, hint, action }: { label: string; children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div data-form-row className="flex items-start gap-3 border-t px-3 py-2.5 first:border-t-0" style={{ borderColor: "var(--hairline)" }}>
      <span className="w-[4.5rem] shrink-0 pt-2.5 text-xs font-bold muted">{label}</span>
      <div className="min-w-0 flex-1">{children}{hint && <span className="mt-1.5 block text-xs muted">{hint}</span>}</div>
      {action && <span className="shrink-0 pt-2">{action}</span>}
    </div>
  );
}

// 折叠行:与 FormRow 共用同一列网格(标签 / 控件),展开内容不再单独套框。
function AccordionRow({ label, summary, open, onToggle, children }: { label: string; summary?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-t" style={{ borderColor: "var(--hairline)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 px-3 text-sm font-bold">
        <span className="w-[4.5rem] shrink-0 text-xs font-bold muted">{label}</span>
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <ChevronDown size={17} className={"shrink-0 transition " + (open ? "rotate-180" : "")} style={{ color: "var(--muted)" }} />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

function RemainingLevelInline({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const level = Math.min(100, Math.max(0, Math.round(value)));
  const color = level <= 20 ? "var(--danger)" : level <= 45 ? "var(--warning)" : "var(--primary)";
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={0} max={100} step={5} value={level} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1" aria-label="剩余量" style={{ accentColor: color }} />
      <span className="w-10 shrink-0 text-right text-sm font-black tabular-nums" style={{ color }}>{level}%</span>
    </div>
  );
}

export function DateField({ label, value, onChange, presets, min, max, clearable = true, relative = true, help }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  presets?: DatePickerPreset[];
  min?: string;
  max?: string;
  clearable?: boolean;
  /** 面向未来的字段(保质期/任务)才显示「还有 N 天」,采购日期显示「已过期」没有意义。 */
  relative?: boolean;
  help?: React.ReactNode;
}) {
  return <FormRow label={label} hint={help}><DatePicker value={value} onChange={onChange} label={label} presets={presets} min={min} max={max} clearable={clearable} hint={relative ? "relative" : "none"} /></FormRow>;
}
export function QuickLocationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (location: Location) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { onCreated(await request<Location>("/api/locations", { method: "POST", body: JSON.stringify({ name, color: "#7c3aed", icon: "Package" }) })); } catch (reason) { setError(reason instanceof Error ? reason.message : "创建位置失败"); } finally { setSaving(false); } };
  useEscapeClose(onClose);
  return <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.form aria-modal="true" role="dialog" aria-labelledby="quick-location-title" onSubmit={submit} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} className="w-full max-w-sm overflow-y-auto rounded-[28px] p-5 shadow-2xl sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><MapPin size={18} /></div><div className="min-w-0 flex-1"><h3 id="quick-location-title" className="m-0 text-base font-black leading-snug">新建存放位置</h3><p className="mb-0 mt-1 text-xs leading-5 muted">创建后会自动选中，可继续录入物品。</p></div><button type="button" onClick={onClose} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0" aria-label="关闭新建位置" title="关闭"><X size={17} /></button></div><Field label="位置名称"><input autoFocus required maxLength={30} className="input mt-4" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：阳台收纳柜" /></Field>{error && <p className="m-0 mt-3 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="mt-5 flex gap-3"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button disabled={saving} className="btn-primary flex-1 disabled:opacity-60">{saving ? "创建中…" : "创建并选中"}</button></div></motion.form></motion.div>;
}

