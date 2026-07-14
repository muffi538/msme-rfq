"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
//
// The dropdown popup is portaled to document.body (fixed-positioned against
// the trigger's bounding rect) rather than absolutely positioned inside this
// component's own DOM subtree — the forms that embed this component use
// `overflow-hidden` on their outer card (to clip rounded corners), which
// would otherwise clip the popup and make it look broken/cut-off.
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
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // No SSR-mount guard needed for the portal below: `open` only ever becomes
  // true via a client-side click/focus handler, so by the time it's true
  // we're already mounted on the client and `document` is safe to use.
  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
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
        className="flex flex-wrap items-center gap-1.5 min-h-[42px] px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white cursor-text focus-within:ring-2 focus-within:ring-blue-600/20 focus-within:border-blue-600 transition-colors"
      >
        {selected.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-md bg-blue-50 text-blue-700 font-medium"
          >
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(v); }}
              className="rounded hover:bg-blue-100 p-0.5"
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

      {open && pos && createPortal(
        <div
          ref={popupRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 max-h-64 overflow-y-auto"
        >
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
                  {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-600" />}
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
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-blue-600 hover:bg-blue-50 font-medium disabled:opacity-50",
                filtered.length > 0 && "border-t border-gray-100 mt-1 pt-2"
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {creating ? "Adding…" : (createLabel ? createLabel(trimmedQuery) : `Add "${trimmedQuery}"`)}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
