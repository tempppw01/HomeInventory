"use client";

import { AnimatePresence, motion } from "motion/react";
import { Search, ChevronRight } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Item } from "@/types";
import { SearchHistory, saveSearchHistory, clearSearchHistory } from "./search-history";

export function SearchBox({ 
  items, 
  value, 
  onChange, 
  onSelect, 
  onFocus, 
  placeholder 
}: { 
  items: Item[]; 
  value: string; 
  onChange: (value: string) => void; 
  onSelect: (item: Item) => void; 
  onFocus?: () => void; 
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [historyHasEntries, setHistoryHasEntries] = useState(false);
  const listId = useId();

  // Empty query is not a query: it used to expand into "the first 6 items in the
  // house", a 361px panel that covered the quick-filter row below and swallowed
  // clicks meant for it. Suggestions now require an actual search term.
  const suggestions = useMemo(() => {
    const term = value.trim().toLowerCase();
    if (!term) return [];
    return items
      .filter((item) => 
        [item.name, item.itemCode, item.category, item.location?.name].some((field) => 
          field?.toLowerCase().includes(term)
        )
      )
      .slice(0, 6);
  }, [items, value]);

  const closePopover = () => {
    setOpen(false);
    setShowHistory(false);
  };

  const handleSelect = (item: Item) => {
    onSelect(item);
    closePopover();
    saveSearchHistory(item.name);
  };

  const handleHistorySelect = (query: string) => {
    onChange(query);
    closePopover();
  };

  const handleClearHistory = async () => {
    await clearSearchHistory();
    setHistoryHasEntries(false);
    setShowHistory(false);
  };

  const moveActive = (nextIndex: number) => {
    if (suggestions.length === 0) return;
    setActiveIndex(Math.min(Math.max(nextIndex, 0), suggestions.length - 1));
  };

  // Render nothing at all when there is nothing to show: an empty overlay is
  // still a pointer-events surface sitting on top of the toolbar beneath.
  const showHistoryPanel = !value && showHistory && historyHasEntries;
  const showSuggestions = value.trim().length > 0;
  const popoverOpen = open && (showHistoryPanel || showSuggestions);

  return (
    <div className="relative z-20">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 muted" size={18} />
      <input
        id="global-search"
        value={value}
        role="combobox"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? listId : undefined}
        aria-autocomplete="list"
        aria-label={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setOpen(true);
          setShowHistory(false);
        }}
        onFocus={() => {
          setOpen(true);
          setShowHistory(!value);
          onFocus?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            moveActive(activeIndex + 1);
          } else if (event.key === "ArrowUp" && suggestions.length > 0) {
            event.preventDefault();
            moveActive(activeIndex - 1);
          } else if (event.key === "Enter" && suggestions[activeIndex]) {
            event.preventDefault();
            handleSelect(suggestions[activeIndex]);
          } else if (event.key === "Escape") {
            closePopover();
          }
        }}
        onBlur={() => setTimeout(() => closePopover(), 120)}
        className="input search-input"
        placeholder={placeholder}
        autoComplete="off"
      />
      <AnimatePresence>
        {popoverOpen && (
          <motion.div
            id={listId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 4 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 top-full max-h-72 overflow-y-auto overscroll-contain rounded-2xl border p-1 shadow-2xl"
            style={{ background: "var(--surface-solid)", borderColor: "var(--border)" }}
          >
            {showHistoryPanel ? (
              <SearchHistory 
                onSelect={handleHistorySelect} 
                onClear={handleClearHistory}
                onHasEntries={setHistoryHasEntries}
              />
            ) : suggestions.length > 0 ? (
              suggestions.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(item)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"
                  style={index === activeIndex ? { background: "var(--surface-soft)" } : undefined}
                >
                  <div
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-cover bg-center text-lg"
                    style={
                      item.imageUrl
                        ? { backgroundImage: 'url(' + item.imageUrl + ')' }
                        : { background: "var(--surface-soft)" }
                    }
                  >
                    {!item.imageUrl && "📦"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{item.name}</div>
                    <div className="mt-0.5 truncate text-[11px] muted">
                      {item.itemCode || item.id} · {item.location?.name || "未设置位置"}
                    </div>
                  </div>
                  <ChevronRight size={14} className="muted" />
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-xs muted">
                没有找到物品
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
