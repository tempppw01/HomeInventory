"use client";

import { Clock, X } from "lucide-react";
import { useEffect, useState } from "react";

type SearchHistoryEntry = { id: string; query: string; createdAt: string };

export function SearchHistory({ onSelect, onClear, onHasEntries }: { onSelect: (query: string) => void; onClear: () => void; onHasEntries?: (hasEntries: boolean) => void }) {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/search-history")
      .then((res) => res.json())
      .then((data: SearchHistoryEntry[]) => {
        if (active) {
          setHistory(data);
          onHasEntries?.(data.length > 0);
        }
      })
      .catch(() => {
        if (active) {
          setHistory([]);
          onHasEntries?.(false);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [onHasEntries]);

  if (loading) return null;
  if (history.length === 0) return null;

  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-xs font-bold muted">最近搜索</span>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 text-xs font-bold muted hover:text-[var(--foreground)]"
        >
          <X size={12} />
          清空
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 px-2">
        {history.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.query)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition hover:bg-[var(--surface-soft)]"
            style={{ color: "var(--muted)" }}
          >
            <Clock size={11} />
            {entry.query}
          </button>
        ))}
      </div>
    </div>
  );
}

export async function saveSearchHistory(query: string) {
  if (!query.trim()) return;
  try {
    await fetch("/api/search-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim() }),
    });
  } catch {
    // Silently fail on history save
  }
}

export async function clearSearchHistory() {
  try {
    await fetch("/api/search-history", { method: "DELETE" });
  } catch {
    // Silently fail
  }
}
