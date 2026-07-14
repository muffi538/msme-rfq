"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Searchable multi-select with removable chips for the selected values and
// an inline "+ Add" row to create a value outside the predefined list
// (when `onCreate` is provided) — e.g. supplier Brands, where the list is
// seeded with common options but not exhaustive. Deliberately hand-rolled
// (matches this app's existing pattern of plain buttons/divs for pickers
// like the Categories field and the inbox Label selector) rather than
// built on an unfamiliar multi-part library primitive that can't be
// visually verified in this environment.
export function MultiSelectSearch({
  options,
  selected,
  onChange,
  onCreate,
  creating = false,
  onDelete,
  isCustom,
  placeholder = "Search…",
  emptyLabel = "No matches",
  createLabel,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  onCreate?: (value: string) => void;
  /** Disables the create row while a create is in flight, preventing a double-submit. */
  creating?: boolean;
  /** Deletes a value from the underlying options list entirely (not just this selection) — only offered when `isCustom(value)` is true. */
  onDelete?: (value: string) => void;
  isCustom?: (value: string) => boolean;
  placeholder?: string;
  emptyLabel?: string;
  createLabel?: (query: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const trimmedQuery = query.trim();
  const filtered = options.filter((o) => o.toLowerCase().includes(trimmedQuery.toLowerCase()));
  const exactMatch = options.some((o) => o.toLowerCase() === trimmedQuery.toLowerCase());
  const showCreate = Boolean(onCreate) && trimmedQuery.length > 0 && !exactMatch;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  function handleCreate() {
    if (!onCreate || !trimmedQuery) return;
    onCreate(trimmedQuery);
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
        className="flex flex-wrap items-center gap-1.5 min-h-[42px] px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white cursor-text focus-within:ring-2 focus-within:ring-[#1847F5]/20 focus-within:border-[#1847F5] transition-colors"
      >
        {selected.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-md bg-[#1847F5]/8 text-[#1847F5] font-medium"
          >
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(v); }}
              className="rounded hover:bg-[#1847F5]/15 p-0.5"
              title={`Remove ${v}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[100px] text-sm outline-none bg-transparent placeholder:text-gray-400"
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 w-full max-h-64 overflow-y-auto">
          {filtered.length === 0 && !showCreate && (
            <p className="px-3 py-2 text-sm text-gray-400">{emptyLabel}</p>
          )}
          {filtered.map((opt) => {
            const isSelected = selected.includes(opt);
            const deletable = Boolean(onDelete) && Boolean(isCustom?.(opt));
            return (
              <div key={opt} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle(opt)}
                  className={cn(
                    "flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                    isSelected ? "bg-gray-50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-50"
                  )}
                >
                  {opt}
                  {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-[#1847F5]" />}
                </button>
                {deletable && (
                  <button
                    type="button"
                    onClick={() => onDelete?.(opt)}
                    title={`Remove "${opt}" from the list`}
                    className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {showCreate && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-[#1847F5] hover:bg-[#1847F5]/5 font-medium disabled:opacity-50",
                filtered.length > 0 && "border-t border-gray-100 mt-1 pt-2"
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {creating ? "Adding…" : (createLabel ? createLabel(trimmedQuery) : `Add "${trimmedQuery}"`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
