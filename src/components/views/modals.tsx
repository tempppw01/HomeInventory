"use client";

// 本文件里的 <img> 都是用户上传图片的预览(data URL 或任意 OSS 地址),
// next/image 需要预先配置域名、也无法处理 data URL,所以这里显式关闭该规则。
/* eslint-disable @next/next/no-img-element */

import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import {
  CalendarCheck, Check, ChevronRight, MapPin, Package, Pencil, Printer, ShoppingBasket, X } from "lucide-react";
import { FormEvent, useContext, useEffect, useState } from "react";
import type { Item, Location } from "@/types";
import { wouldFormLocationCycle } from "@/lib/location-tree";
import { ReadOnlyContext } from "@/components/shared";
import { lowStockTrigger } from "@/lib/low-stock";
import { APP_VERSION } from "@/lib/version";
import { Field } from "@/components/ui-kit";
import { Empty, ListRow } from "@/components/ui-kit";
import { useEscapeClose } from "@/lib/use-escape-close";
import { units, request } from "../shared";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { copyToClipboard } from "@/lib/clipboard";
import { ClipboardCopy, ExternalLink } from "lucide-react";
import { isWeeklyReviewDay, weekdayLabel } from "@/lib/weekly-review";

// 弹窗统一语言:28px 圆角 + 暖面(--surface-solid)+ 柔和 scrim。
// 面板样式集中在这里,避免各个弹窗各写一套背景与圆角造成割裂。
const dialogPanelStyle = { background: "var(--surface-solid)" } as const;
const dialogPanelClass = "w-full overflow-y-auto rounded-[28px] p-5 shadow-2xl sm:p-6";
export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  // 关闭时把焦点还给触发它的元素。
  // 不做这件事的话,键盘用户关掉弹窗后焦点会掉到 body 上,再按 Tab 就从页面开头重新走一遍。
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      // 原节点可能已被 React 替换,这时按可访问名重新找回来(直接 focus 一个脱离文档的节点是无效的)。
      const target = opener && opener.isConnected
        ? opener
        : (opener?.getAttribute("aria-label")
            ? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(opener.getAttribute("aria-label") ?? "")}"]`)
            : null);
      target?.focus?.();
    };
  }, []);
  useEscapeClose(onClose);
  // 手机上软键盘只缩小 visualViewport、不缩小布局视口,固定 88dvh 的弹层会把
  // 底部(含保存按钮)留在键盘后面。跟随 visualViewport 收一次高度即可。
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => setViewportHeight(viewport.height);
    const frame = requestAnimationFrame(sync);
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("resize", sync); viewport.removeEventListener("scroll", sync); };
  }, []);
  const keyboardInset = viewportHeight !== null && viewportHeight < window.innerHeight - 80;
  return <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onFocusCapture={(event) => { if (window.innerWidth >= 768) return; const target = event.target as HTMLElement; window.setTimeout(() => target.scrollIntoView({ block: "nearest" }), 220); }}><motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ y: 12, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0, scale: .98, transition: { duration: .18, ease: [0.23, 1, 0.32, 1] } }} transition={{ type: "spring", damping: 28, stiffness: 340 }} className="max-h-[min(92vh,88dvh)] w-full max-w-lg overflow-y-auto rounded-t-[28px] rounded-b-none p-5 shadow-2xl sm:rounded-[28px] sm:p-6" style={keyboardInset ? { background: "var(--surface-solid)", maxHeight: `${Math.max(240, viewportHeight - 16)}px` } : { background: "var(--surface-solid)" }}><div className="mb-5 flex items-start gap-3 sm:mb-6"><div className="min-w-0 flex-1"><h2 className="m-0 text-xl font-black leading-snug">{title}</h2><p className="mb-0 mt-1 text-xs muted">{subtitle}</p></div><button type="button" onClick={onClose} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0" aria-label={`关闭${title}`} title="关闭"><X size={17} /></button></div>{children}</motion.div></motion.div>;
}

export function NotificationsModal({ lowStock, expiring, expired, onClose, onOpenItem, onOpenDetail, onDispose, onShopping, weeklyReview, onStartReview }: { lowStock: Item[]; expiring: Item[]; expired: Item[]; onClose: () => void; onOpenItem: (item: Item) => void; onOpenDetail: (item: Item) => void; onDispose: (item: Item) => void; onShopping: () => void; weeklyReview?: { weeklyReviewEnabled: boolean; weeklyReviewDay: number } | null; onStartReview?: () => void }) {
  const alerts = [
    ...expired.map((item) => ({ item, label: `${["食品", "饮品"].includes(item.category) ? "食品" : "物品"}已过期 · ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`, color: "var(--danger)" })),
    ...expiring.filter((item) => !expired.some((old) => old.id === item.id)).map((item) => ({ item, label: `${["食品", "饮品"].includes(item.category) ? "食品即将到期" : "即将到期"} · ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`, color: "var(--warning)" })),
    ...lowStock.filter((item) => !expired.some((old) => old.id === item.id)).map((item) => ({ item, label: lowStockTrigger(item) === "liquid" ? `剩余量仅 ${Math.round(item.remainingPercent)}%` : `库存仅剩 ${item.quantity} ${item.unit}`, color: "#e37d25" })),
  ];
  // 今天是用户设定的每周盘点日 → 给一个直接进入盘点的入口。
  // (这个偏好以前是死开关:能设、能存、没人用。)
  const weeklyDue = isWeeklyReviewDay(weeklyReview);

  return <Modal title="提醒中心" subtitle={alerts.length ? `${alerts.length} 条待处理事项` : undefined} onClose={onClose}>
    {weeklyDue && onStartReview && <div className="mb-2 flex items-center gap-3 rounded-2xl p-3" style={{ background: "var(--primary-soft)" }}>
      <CalendarCheck size={18} className="shrink-0" style={{ color: "var(--primary)" }} />
      <span className="min-w-0 flex-1 text-sm font-bold">今天是你设定的每周盘点日({weekdayLabel(weeklyReview?.weeklyReviewDay ?? 0)})</span>
      <button type="button" onClick={onStartReview} className="btn-primary h-9 shrink-0 px-3 text-xs">开始盘点</button>
    </div>}<div className="space-y-1">{alerts.map(({ item, label, color }) => (
          <AlertRow
            key={`${item.id}-${label}`}
            item={item}
            label={label}
            color={color}
            canDispose={expired.some((entry) => entry.id === item.id)}
            onOpenItem={onOpenItem}
            onOpenDetail={onOpenDetail}
            onDispose={onDispose}
          />
        ))}{alerts.length === 0 && <Empty icon={Check} title="暂无提醒" text="库存和保质期都在安全范围内" />}</div>{lowStock.length > 0 && <button onClick={onShopping} className="btn-primary mt-4 w-full">查看采购清单</button>}</Modal>;
}

/** 提醒中心的一条:右键可「查看物品 / 复制物品编号 / 处理掉」。 */
function AlertRow({ item, label, color, canDispose, onOpenItem, onOpenDetail, onDispose }: { item: Item; label: string; color?: string; canDispose: boolean; onOpenItem: (item: Item) => void; onOpenDetail: (item: Item) => void; onDispose: (item: Item) => void }) {
  // 只读账号在提醒中心里只能看:点整行、右键菜单的「编辑物品」、「处理掉」都是写操作
  // (openEdit 会在保存时 PATCH,removeItem 直接 DELETE),一律换成「查看详情」或不出现。
  const readOnly = useContext(ReadOnlyContext);
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [
    { label: "查看详情", icon: ExternalLink, onClick: () => onOpenDetail(item) },
    ...(readOnly ? [] : [{ label: "编辑物品", icon: Pencil, onClick: () => onOpenItem(item) }]),
    { label: "复制物品编号", icon: ClipboardCopy, onClick: () => { void copyToClipboard(item.itemCode || item.id); } },
    ...(canDispose && !readOnly ? [{ label: "处理掉这件", danger: true, separatorBefore: true, onClick: () => onDispose(item) }] : []),
  ];
  return (
    <>
      <div onContextMenu={context.onContextMenu}>
        <ListRow
          title={<><span className="mr-2 inline-block size-2 shrink-0 rounded-full align-middle" style={{ background: color }} />{item.name}</>}
          meta={label}
          onClick={() => (readOnly ? onOpenDetail(item) : onOpenItem(item))}
          trailing={canDispose && !readOnly ? <button type="button" onClick={() => onDispose(item)} className="shrink-0 rounded-xl px-2 py-1.5 text-xs font-bold" style={{ background: "var(--danger-soft, #ffe8eb)", color: "var(--danger)" }}>处理掉</button> : <ChevronRight size={16} className="shrink-0 muted" />}
        />
      </div>
      <ContextMenu menu={context.menu} items={contextItems} onClose={context.close} />
    </>
  );
}

export function WelcomeModal({ hasDemoData, onClose, onAction }: { hasDemoData: boolean; onClose: () => void; onAction: (action: "item" | "location" | "shopping") => void }) {
  useEscapeClose(onClose);
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="欢迎使用" className="fixed inset-0 z-[90] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.div initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={`${dialogPanelClass} max-w-md`} style={dialogPanelStyle}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="text-xs font-bold" style={{ color: "var(--primary)" }}>欢迎使用 · v{APP_VERSION}</div><h2 className="mb-0 mt-1 text-xl font-black leading-snug">从一件小事开始整理</h2></div><button type="button" onClick={onClose} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0" aria-label="暂时跳过欢迎引导" title="关闭"><X size={17} /></button></div><p className="mb-0 mt-3 text-sm leading-6 muted">{hasDemoData ? "示范数据已经准备好。也可以从下面任意一步开始，完成后引导会自动收起。" : "只需选一个起点，剩下的以后慢慢补齐。完成第一步后，这张小卡会自动收起。"}</p><div className="mt-4 grid gap-2"><WelcomeAction icon={Package} title="录入一件物品" text="从眼前的东西开始" onClick={() => onAction("item")} /><WelcomeAction icon={MapPin} title="建一个家庭空间" text="例如厨房、衣柜或收纳箱" onClick={() => onAction("location")} /><WelcomeAction icon={ShoppingBasket} title="写一条购物清单" text="先把下次要买的记住" onClick={() => onAction("shopping")} /></div><button onClick={onClose} className="mt-4 min-h-11 w-full text-xs font-bold muted hover:text-[var(--foreground)]">我先随便看看</button></motion.div></motion.div>;
}

export function WelcomePoint({ icon: Icon, text }: { icon: typeof Package; text: string }) { return <div className="flex items-center gap-2 rounded-2xl p-3 text-xs font-bold" style={{ background: "var(--surface-soft)" }}><Icon size={16} style={{ color: "var(--primary)" }} />{text}</div>; }
export function WelcomeAction({ icon: Icon, title, text, onClick }: { icon: typeof Package; title: string; text: string; onClick: () => void }) { return <ListRow icon={Icon} title={title} meta={text} onClick={onClick} />; }

export function QrModal({ item, onClose, onPrint }: { item: Item; onClose: () => void; onPrint: () => void }) {
  const url = `${globalThis.location?.origin || ""}/items/${item.id}`;
  return <Modal title="物品二维码" subtitle="扫码即可快速查看物品信息" onClose={onClose}><div className="grid place-items-center"><div className="rounded-3xl bg-white p-4 sm:p-5"><QRCodeSVG value={url} size={220} level="M" includeMargin /></div><div className="mt-4 text-center"><div className="text-lg font-black">{item.name}</div><div className="mt-1 font-mono text-xs muted">{item.itemCode || item.id}</div><div className="mt-2 text-xs muted">{item.category} · {item.location?.name || "未设置位置"} · {item.quantity}{item.unit}</div></div><div className="mt-5 flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">打开详情</a><button onClick={onPrint} className="btn-primary flex items-center gap-2 text-sm"><Printer size={16} />打印二维码</button></div></div></Modal>;
}

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEscapeClose(onClose);
  return <motion.div role="dialog" aria-modal="true" aria-label="图片预览" className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-5 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.div className="relative max-h-full max-w-full" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .96 }}><img src={src} alt={alt} className="max-h-[82dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl" /><button type="button" onClick={onClose} className="absolute -right-3 -top-3 grid size-9 place-items-center rounded-full bg-white text-black shadow-lg" aria-label="关闭图片预览" title="关闭"><X size={18} /></button></motion.div></motion.div>;
}

export function ShoppingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [name, setName] = useState(""); const [quantity, setQuantity] = useState(1); const [unit, setUnit] = useState("件"); const submit = async (e: FormEvent) => { e.preventDefault(); await request("/api/shopping", { method: "POST", body: JSON.stringify({ name, quantity, unit, priority: 1, source: "manual" }) }); onSaved(); }; return <Modal title="添加采购项" subtitle="想到什么就记下来，买齐后打勾。" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="需要采购什么？"><input autoFocus required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：厨房纸" /></Field><div className="grid grid-cols-2 gap-3"><Field label="数量"><input type="number" min="0.1" step="0.1" className="input" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field><Field label="单位"><select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field></div><div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button className="btn-primary flex-1">加入清单</button></div></form></Modal>; }

export function LocationModal({ location, locations, onClose, onSaved }: { location: Location | null; locations: Location[]; onClose: () => void; onSaved: () => void }) { const [name, setName] = useState(location?.name || ""); const [color, setColor] = useState(location?.color || "#7c3aed"); const [parentId, setParentId] = useState(location?.parentId || ""); const [error, setError] = useState(""); const [thumbnailUrl, setThumbnailUrl] = useState(location?.thumbnailUrl || "");
  // 上级候选里不能出现「会成环」的那些:除自己以外,还要排掉自己的**后代**
  // (实测:厨房→橱柜→抽屉 之后把厨房的上级选成抽屉,服务端当时只查一层,放行了)。
  const nodes = locations.map((entry) => ({ id: entry.id, parentId: entry.parentId ?? null }));
  const parentOptions = locations.filter((entry) => entry.id !== location?.id && !(location && wouldFormLocationCycle(nodes, location.id, entry.id))); const submit = async (e: FormEvent) => { e.preventDefault(); setError(""); try { await request(location ? `/api/locations/${location.id}` : "/api/locations", { method: location ? "PATCH" : "POST", body: JSON.stringify({ name, color, parentId: parentId || null, icon: location?.icon || "Package", thumbnailUrl: thumbnailUrl.trim() }) }); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); } }; return <Modal title={location ? "编辑家庭空间" : "添加家庭空间"} subtitle="房间、柜子或任何方便查找的位置。" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="空间名称"><input autoFocus required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：主卧衣柜" /></Field><Field label="所属上级空间"><select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">顶级空间</option>{parentOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.parent?.name ? `${entry.parent.name} · ` : ""}{entry.name}</option>)}</select></Field><Field label="缩略图 URL(可选)"><input className="input" value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="留空则不显示背景图" /></Field><Field label="标记颜色"><div className="flex items-center gap-3"><input type="color" className="h-11 w-16 cursor-pointer rounded-xl border-0 bg-transparent" value={color} onChange={(e) => setColor(e.target.value)} /><span className="text-sm muted">用于快速区分空间</span></div></Field>{error && <p className="m-0 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button className="btn-primary flex-1">{location ? "保存修改" : "创建空间"}</button></div></form></Modal>; }

