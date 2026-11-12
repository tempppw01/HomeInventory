"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import type { ItemType, Location } from "@/types";
import { useEscapeClose } from "@/lib/use-escape-close";

const units = ["件", "个", "盒", "瓶", "袋", "卷", "包", "台", "kg", "L", "ml"];
const categories = ["日用", "食品", "饮品", "清洁", "家电", "数码", "衣物", "医药", "户外", "其他"];
// "不修改" and "清除位置" both used to be value="": the controlled <select>
// snapped straight back to "不修改" and the submit body only ever carried ids.
// "清除位置" now has its own sentinel that maps to an explicit null.
const CLEAR_LOCATION = "__clear__";

export function BatchEditModal({
  selectedCount,
  initialCategory,
  locations,
  onClose,
  onApply,
}: {
  selectedCount: number;
  initialCategory: string;
  initialLocationId: string;
  locations: Location[];
  onClose: () => void;
  onApply: (updates: {
    category?: string;
    type?: ItemType;
    unit?: string;
    minQuantity?: number;
    locationId?: string | null;
  }) => void;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [type, setType] = useState<ItemType | "">("");
  const [unit, setUnit] = useState("");
  const [minQuantity, setMinQuantity] = useState<string>("");
  const [locationId, setLocationId] = useState<string | typeof CLEAR_LOCATION | "">("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updates: {
      category?: string;
      type?: ItemType;
      unit?: string;
      minQuantity?: number;
      locationId?: string | null;
    } = {};
    
    if (category !== initialCategory) updates.category = category;
    if (type) updates.type = type;
    if (unit) updates.unit = unit;
    if (minQuantity !== "") updates.minQuantity = Number(minQuantity);
    if (locationId === CLEAR_LOCATION) updates.locationId = null;
    else if (locationId !== "") updates.locationId = locationId;
    
    onApply(updates);
  };

  useEscapeClose(onClose);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 35, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 25, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 340 }}
        role="dialog"
        aria-modal="true"
        aria-label="批量编辑物品"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] p-5 shadow-2xl sm:rounded-[28px] sm:p-6"
        style={{ background: "var(--surface-solid)" }}
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="m-0 text-xl font-black">批量编辑物品</h2>
            <p className="mb-0 mt-1 text-xs muted">
              将同时修改 {selectedCount} 件物品
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost grid size-9 min-h-9 place-items-center p-0"
            aria-label="关闭批量编辑"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1.5 block text-xs font-bold muted">分类</span>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-bold muted">类型</span>
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value as ItemType | "")}
              >
                <option value="">不修改</option>
                <option value="DURABLE">耐用品</option>
                <option value="CONSUMABLE">消耗品</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1.5 block text-xs font-bold muted">单位</span>
              <select
                className="input"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="">不修改</option>
                {units.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-bold muted">低库存阈值</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="input"
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
                placeholder="不修改"
              />
            </label>
          </div>

          <label>
            <span className="mb-1.5 block text-xs font-bold muted">存放位置</span>
            <select
              className="input"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">不修改</option>
              <option value={CLEAR_LOCATION}>清除位置</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost flex-1"
            >
              取消
            </button>
            <button type="submit" className="btn-primary flex-1">
              应用到 {selectedCount} 件物品
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
