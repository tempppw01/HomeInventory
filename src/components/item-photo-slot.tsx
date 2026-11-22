"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Package } from "lucide-react";

import { compressImage } from "@/components/shared";

/**
 * 物品详情页顶部那一块:有照片显示照片,没有照片就不再只是**一块空白**。
 *
 * 此前这里是一个 h-52(208px)的空色块加一个 56px 的装饰图标:
 * 390×844 实测,物品名被推到 y=317,四分之一屏的空白之后才开始有内容;
 * 而详情页本身**没有任何上传入口**(要加照片只能绕回列表卡片右键,或者进「编辑物品」的图片折叠行)。
 * 现在空态收成 96px,并且就地给出上传入口 —— 键盘同样到得了
 * (复用列表卡片那套 .file-label + sr-only 输入框,见 globals.css)。
 */
export function ItemPhotoSlot({ itemId, itemName, imageUrl, readOnly }: {
  itemId: string;
  itemName: string;
  imageUrl: string | null;
  /** 只读账号不显示上传入口:接口本身会拦,界面上也不该出现点了会被拒的按钮。 */
  readOnly: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (imageUrl) {
    return <div className="h-64 bg-cover bg-center sm:h-80" style={{ backgroundImage: `url(${imageUrl})` }} />;
  }

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      // 与列表卡片走同一条路:先压缩再上传,再把这件物品的 imageUrl 指过去。
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("file", compressed);
      const uploaded = await fetch("/api/upload", { method: "POST", body: form });
      const result = await uploaded.json().catch(() => ({}));
      if (!uploaded.ok || !result.url) throw new Error(result.error || "上传失败");
      const saved = await fetch(`/api/items/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: result.url }) });
      if (!saved.ok) {
        const detail = await saved.json().catch(() => ({}));
        throw new Error(detail.error || "保存失败");
      }
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-24 items-center gap-3 px-5 py-3" style={{ background: "var(--surface-soft)" }}>
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--surface-solid)", color: "var(--muted)" }}>
        <Package size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">还没有照片</span>
        <span className="mt-0.5 block text-xs leading-5 muted">{error || "拍一张放上来,以后找东西更快"}</span>
      </span>
      {!readOnly && (
        <label className="file-label btn-ghost flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm font-bold">
          <ImagePlus size={15} />
          {busy ? "上传中..." : "上传照片"}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" disabled={busy} aria-label={`给「${itemName}」上传照片`} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </label>
      )}
    </div>
  );
}
