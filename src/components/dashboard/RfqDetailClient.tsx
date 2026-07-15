"use client";

import { useState, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Loader2, Split, Send, CheckCircle, AlertTriangle,
  MessageCircle, Mail, Package, Pencil, Copy, ExternalLink, Users,
  ChevronDown, ChevronUp, ChevronRight, ImageOff, Download, FileSpreadsheet, FileText,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { RfqWorkflowTracker } from "@/components/dashboard/RfqWorkflowTracker";
import { RfqLifecycleExpand } from "@/components/dashboard/RfqLifecycleExpand";
import {
  type BuyerReplyLog,
  type OutgoingStats,
  computeWorkflowSteps,
  isWorkflowComplete,
} from "@/lib/rfq-lifecycle";
import { exportItemsToExcel, exportItemsToCsv, exportItemsToPdf } from "@/lib/exportRfqItems";
import { normalizePhone, buildWaUrl, isValidWhatsappGroupLink } from "@/lib/whatsapp";
import { BUILT_IN_CATEGORIES as PRESET_CATEGORIES } from "@/lib/categories";

const CUSTOM_VALUE = "__CUSTOM__";

// Optional per-item colour — fixed palette, no custom-value escape hatch
// (unlike category), since the spec asks for a plain dropdown only.
const COLOUR_OPTIONS = [
  "Red", "Blue", "Yellow", "Green", "Orange", "Purple", "Pink",
  "Brown", "Black", "White", "Grey", "Silver", "Gold", "Rose Gold",
];
// Sentinel for "no colour selected" — Select items can't use an empty
// string as a value, and this keeps the underlying stored value as a
// genuine `null` (default/unset) rather than an empty string.
const COLOUR_NONE = "__NONE__";

const statusStyle: Record<string, string> = {
  draft:       "bg-gray-100 text-gray-600",
  approved:    "bg-blue-100 text-blue-700",
  sent:        "bg-green-100 text-green-700",
  failed:      "bg-red-100 text-red-700",
  no_supplier: "bg-yellow-100 text-yellow-700",
};

type Item = {
  id: string; line_number: number; name: string;
  qty: number | null; unit: string | null; brand: string | null;
  spec: string | null; category: string; category_confidence: number;
  flagged: boolean;
  part_number?: string | null; delivery_details?: string | null;
  confidence?: number | null; warnings?: string[] | null; merged_from_count?: number | null;
  source_files?: string[] | null;
  colour?: string | null;
};

type OutgoingRfq = {
  id: string; child_code: string; category: string; message_body: string;
  channel: string; status: string; sent_at: string | null;
  suppliers: { name: string; whatsapp_number: string | null; whatsapp_group_link: string | null; email: string | null } | null;
};

type OutgoingItem = { outgoing_rfq_id: string; item_id: string };

type ItemImage = {
  id: string; item_id: string | null; file_url: string; source_file_name: string | null;
  match_confidence: number | null; signedUrl: string | null;
};

// One row per source file this RFQ was built from — every attachment PLUS
// (when present) a synthetic "(email body)" row for line items typed
// directly into the email itself, so a source that isn't a real uploaded
// file still shows up here instead of being invisible.
type RfqFile = {
  id: string; file_name: string; file_type: string;
  status: string | null; error: string | null; created_at: string;
};

type Rfq = {
  id: string; rfq_code: string; buyer_name: string | null;
  buyer_email: string | null; status: string; priority: string;
  file_name: string | null; created_at: string;
  source_rfq_number?: string | null; source_date?: string | null; warnings?: string[] | null;
};

// ── Category selector with "Other / type your own" support ──
function CategoryCell({
  item,
  onSave,
}: {
  item: Item;
  onSave: (id: string, cat: string) => void;
}) {
  const isPreset    = PRESET_CATEGORIES.includes(item.category);
  const [editing,   setEditing]   = useState(false);
  const [customVal, setCustomVal] = useState(isPreset ? "" : item.category);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSelect(val: string | null) {
    if (!val) return;
    if (val === CUSTOM_VALUE) {
      setEditing(true);
      setCustomVal("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setEditing(false);
      onSave(item.id, val);
    }
  }

  function commitCustom() {
    const trimmed = customVal.trim().toUpperCase().replace(/\s+/g, "_");
    if (!trimmed) { setEditing(false); return; }
    onSave(item.id, trimmed);
    setEditing(false);
  }

  // If already a custom category, show it with an edit pencil
  if (!isPreset && !editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
          {item.category.replace(/_/g, " ")}
        </span>
        <button
          onClick={() => { setEditing(true); setCustomVal(item.category.replace(/_/g, " ")); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="text-gray-400 hover:text-gray-600"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={customVal}
          onChange={(e) => setCustomVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitCustom(); if (e.key === "Escape") setEditing(false); }}
          placeholder="e.g. Civil Materials"
          className="h-7 text-xs w-40 px-2"
        />
        <Button size="sm" onClick={commitCustom} className="h-7 text-xs px-2 bg-blue-600 hover:bg-blue-700 text-white">
          Save
        </Button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600 text-xs px-1">✕</button>
      </div>
    );
  }

  return (
    <Select value={item.category} onValueChange={handleSelect}>
      <SelectTrigger className="h-7 text-xs w-44">
        <SelectValue>{(val: string) => val.replace(/_/g, " ")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PRESET_CATEGORIES.map((c) => (
          <SelectItem key={c} value={c} className="text-xs">
            {c.replace(/_/g, " ")}
          </SelectItem>
        ))}
        <div className="border-t border-gray-100 my-1" />
        <SelectItem value={CUSTOM_VALUE} className="text-xs text-purple-600 font-medium">
          ✏️ Other — type your own…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── Colour selector — plain fixed-palette dropdown, optional (defaults to
// unset), no custom-value entry per spec. ──
function ColourCell({
  item,
  onSave,
}: {
  item: Item;
  onSave: (id: string, colour: string | null) => void;
}) {
  function handleSelect(val: string | null) {
    onSave(item.id, val === COLOUR_NONE || !val ? null : val);
  }

  return (
    <Select value={item.colour ?? COLOUR_NONE} onValueChange={handleSelect}>
      <SelectTrigger className="h-7 text-xs w-32">
        <SelectValue>{(val: string) => (val === COLOUR_NONE || !val ? "— None —" : val)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={COLOUR_NONE} className="text-xs text-gray-400">
          — None —
        </SelectItem>
        {COLOUR_OPTIONS.map((c) => (
          <SelectItem key={c} value={c} className="text-xs">
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SupplierSplitCard({
  outgoing: o,
  supplierItems,
  isSending,
  isSelected,
  isSent,
  isExpanded,
  onToggleExpand,
  onSelect,
  onMessageChange,
  onSend,
  onOpenGroup,
}: {
  outgoing: OutgoingRfq;
  supplierItems: Item[];
  isSending: boolean;
  isSelected: boolean;
  isSent: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: (checked: boolean) => void;
  onMessageChange: (body: string) => void;
  onSend: (channel: string, whatsappNumber?: string | null) => void;
  onOpenGroup: () => void;
}) {
  const supplierName = o.suppliers?.name ?? "No supplier matched";
  const meta = `${o.child_code} · ${o.category.replace(/_/g, " ")} · ${supplierItems.length} item${supplierItems.length === 1 ? "" : "s"}`;

  return (
    <div
      className={cn(
        "bg-white rounded-lg border overflow-hidden transition-colors",
        isSelected ? "border-blue-300 ring-1 ring-blue-200" : "border-gray-100",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 min-h-[44px]">
        {!isSent && (
          <input
            type="checkbox"
            className="w-4 h-4 rounded accent-blue-600 cursor-pointer flex-shrink-0"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse supplier card" : "Expand message and items"}
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-1 min-w-0 text-left"
        >
          <p className="font-medium text-sm text-gray-900 truncate">{supplierName}</p>
          <p className="text-xs text-gray-400 truncate">{meta}</p>
        </button>

        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0", statusStyle[o.status])}>
          {o.status}
        </span>

        {isSent ? (
          <span className="flex items-center gap-1 text-green-600 text-xs font-medium flex-shrink-0">
            <CheckCircle className="w-3.5 h-3.5" /> Sent
          </span>
        ) : o.suppliers ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            {o.suppliers.whatsapp_number && (
              <Button
                size="sm"
                onClick={() => onSend("whatsapp", o.suppliers?.whatsapp_number)}
                disabled={isSending}
                className="bg-green-600 hover:bg-green-700 text-white h-7 px-2 text-xs gap-1"
                title="Send via WhatsApp"
              >
                {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
                <span className="hidden sm:inline">WA</span>
              </Button>
            )}
            {o.suppliers.whatsapp_group_link && (
              <Button
                size="sm"
                onClick={onOpenGroup}
                disabled={isSending}
                className="bg-teal-600 hover:bg-teal-700 text-white h-7 px-2 text-xs gap-1"
                title="Send to WhatsApp group"
              >
                <Users className="w-3 h-3" />
                <span className="hidden sm:inline">Group</span>
              </Button>
            )}
            {o.suppliers.email && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSend("email")}
                disabled={isSending}
                className="h-7 px-2 text-xs gap-1"
                title="Send via email"
              >
                {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                <span className="hidden sm:inline">Email</span>
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-gray-500">Message</p>
              <button
                type="button"
                onClick={onToggleExpand}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Collapse
              </button>
            </div>
            <Textarea
              value={o.message_body ?? ""}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={8}
              className="text-xs font-sans resize-y min-h-[120px] max-h-64 bg-white"
              placeholder="Edit the message sent to this supplier…"
            />
          </div>

          {supplierItems.length > 0 && (
            <details className="group">
              <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 list-none flex items-center gap-1">
                <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                Items ({supplierItems.length})
              </summary>
              <div className="mt-2 rounded-lg border border-gray-100 bg-white overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-1.5 font-medium">Item</th>
                      <th className="px-3 py-1.5 font-medium w-20">Qty</th>
                      <th className="px-3 py-1.5 font-medium">Spec</th>
                      <th className="px-3 py-1.5 font-medium w-20">Colour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {supplierItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-1.5 font-medium text-gray-800">{item.name}</td>
                        <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                          {item.qty != null ? `${item.qty} ${item.unit ?? ""}` : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400 truncate max-w-[140px]">{item.spec ?? "—"}</td>
                        <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{item.colour ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function RfqDetailClient({
  rfq, items: initialItems, outgoing: initialOutgoing, outgoingItems,
  outgoingStats, buyerLog, itemImages, files, onDirtyChange,
}: {
  rfq: Rfq;
  items: Item[];
  outgoing: OutgoingRfq[];
  outgoingItems: OutgoingItem[];
  outgoingStats: OutgoingStats;
  buyerLog: BuyerReplyLog | null;
  itemImages: ItemImage[];
  // Optional (defaults to []) so this component doesn't hard-require every
  // caller to fetch rfq_files — a legacy single-blob RFQ genuinely has none.
  files?: RfqFile[];
  // Fires whenever this RFQ has locally-edited-but-unsent supplier message
  // text — used by the multi-RFQ workspace to warn before closing a tab.
  // Optional and unused by the single-RFQ page.
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [items, setItems]         = useState<Item[]>(initialItems);
  const [outgoing, setOutgoing]   = useState<OutgoingRfq[]>(initialOutgoing);
  const [splitting, setSplitting] = useState(false);
  const [sending, setSending]     = useState<string | null>(null);
  const [splitError, setSplitError] = useState("");
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const dirtyMessageIds = useRef<Set<string>>(new Set());

  function markMessageDirty(outgoingId: string) {
    dirtyMessageIds.current.add(outgoingId);
    onDirtyChange?.(true);
  }
  function markMessageSent(outgoingId: string) {
    dirtyMessageIds.current.delete(outgoingId);
    onDirtyChange?.(dirtyMessageIds.current.size > 0);
  }

  const workflowSteps = computeWorkflowSteps(outgoingStats, buyerLog);
  const workflowComplete = isWorkflowComplete(workflowSteps);

  // Group send modal
  const [groupModal, setGroupModal] = useState<{ outgoingId: string; groupLink: string; message: string; supplierName: string } | null>(null);
  const [copied, setCopied]         = useState(false);

  // --- Update item category ---
  async function updateCategory(itemId: string, category: string) {
    const previous = items.find((i) => i.id === itemId)?.category;
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, category } : i));
    try {
      const res = await fetch(`/api/rfqs/${rfq.id}/item`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, category }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(`Category updated to "${category.replace(/_/g, " ")}"`);
    } catch {
      // Revert the optimistic update — it never actually saved.
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, category: previous ?? i.category } : i));
      toast.error("Couldn't save category — please try again");
    }
  }

  // --- Update item colour (optional; null clears it) ---
  async function updateColour(itemId: string, colour: string | null) {
    const previous = items.find((i) => i.id === itemId)?.colour ?? null;
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, colour } : i));
    try {
      const res = await fetch(`/api/rfqs/${rfq.id}/item`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, colour }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(colour ? `Colour set to "${colour}"` : "Colour cleared");
    } catch {
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, colour: previous } : i));
      toast.error("Couldn't save colour — please try again");
    }
  }

  // --- Generate supplier split ---
  async function handleSplit() {
    setSplitting(true);
    setSplitError("");
    try {
      const res  = await fetch(`/api/rfqs/${rfq.id}/split`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Split failed");
      setOutgoing(json.outgoing);
      setExpanded(new Set());
      toast.success(`Split complete — ${json.outgoing.length} supplier RFQ(s) generated`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Split failed";
      setSplitError(msg);
      toast.error(msg);
    } finally {
      setSplitting(false);
    }
  }

  // --- Approve + send a child RFQ ---
  function openGroupModal(outgoingId: string, groupLink: string, message: string, supplierName: string) {
    if (!isValidWhatsappGroupLink(groupLink)) {
      toast.error(`"${supplierName}"'s WhatsApp group link looks invalid — it should look like https://chat.whatsapp.com/xxxxx. Update it in Suppliers.`, { duration: 8000 });
      return;
    }
    setGroupModal({ outgoingId, groupLink, message, supplierName });
    setCopied(false);
  }

  async function copyGroupMessage() {
    if (!groupModal) return;
    await navigator.clipboard.writeText(groupModal.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function markOutgoingSent(outgoingId: string, channel: string) {
    const res = await fetch(`/api/rfqs/${rfq.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outgoingId, channel }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? "Could not mark as sent");
    }
    setOutgoing((prev) =>
      prev.map((o) => o.id === outgoingId ? { ...o, status: "sent", sent_at: new Date().toISOString() } : o)
    );
    markMessageSent(outgoingId);
  }

  async function confirmGroupSend() {
    if (!groupModal) return;
    const { outgoingId, groupLink, message } = groupModal;

    if (!isValidWhatsappGroupLink(groupLink)) {
      toast.error("This group link looks invalid. Update it in Suppliers, then try again.");
      return;
    }

    // ⚠️ window.open MUST run synchronously inside the click handler — any
    // `await` before it causes Chrome/Safari to flag it as a programmatic
    // pop-up and silently block it. So open the group FIRST, do everything
    // else after.
    const newWin = window.open(groupLink, "_blank", "noopener,noreferrer");
    if (!newWin) {
      toast.error("Pop-up blocked — please allow pop-ups for this site, then try again.");
      return;
    }

    // Now safe to do async work
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Message copied! Click the text box in the group and press Ctrl+V to paste.", { duration: 6000 });
    } catch {
      toast.warning("Group opened, but the message couldn't be auto-copied — copy it manually from below.", { duration: 6000 });
    }

    try {
      await markOutgoingSent(outgoingId, "whatsapp");
      setGroupModal(null);
    } catch (err) {
      // Group is open and the message is copied either way — only the
      // "mark as sent" bookkeeping failed, so keep the modal open and let
      // the user retry that specific step by clicking Open Group again.
      toast.error(
        `Group opened and message copied, but couldn't record it as sent: ${err instanceof Error ? err.message : "unknown error"}. Click Open Group to retry.`,
        { duration: 8000 }
      );
    }
  }

  async function handleSend(outgoingId: string, channel: string, whatsappNumber?: string | null, message?: string | null) {
    setSending(outgoingId);
    try {
      if (channel === "whatsapp") {
        if (!whatsappNumber) {
          toast.error("This supplier has no WhatsApp number. Add one in Suppliers.");
          return;
        }
        const phone = normalizePhone(whatsappNumber);
        if (!phone) {
          toast.error(`"${whatsappNumber}" isn't a valid WhatsApp number. Update it in Suppliers.`);
          return;
        }
        const newWin = window.open(buildWaUrl(phone, message ?? ""), "_blank", "noopener,noreferrer");
        if (!newWin) {
          toast.error("Pop-up blocked — please allow pop-ups for this site, then try again.");
          return;
        }
        toast.success("WhatsApp opened — tap Send in WhatsApp to deliver the message.");
      } else {
        toast.info("Email channel — marking as sent.");
      }
      await markOutgoingSent(outgoingId, channel);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark as sent. Please try again.");
    } finally {
      setSending(null);
    }
  }

  // Bulk WhatsApp send — fires every window.open() back-to-back BEFORE any
  // await, since browsers only treat pop-ups opened synchronously within
  // the click's call stack as user-initiated; anything after an awaited
  // network call is liable to be blocked regardless of how this is written.
  // Reports exactly what happened instead of the previous silent forEach.
  async function handleBulkWhatsappSend(targets: OutgoingRfq[]) {
    const attempts = targets.map((o) => {
      const phone = normalizePhone(o.suppliers?.whatsapp_number ?? "");
      if (!phone) return { o, win: null as Window | null, invalid: true };
      const win = window.open(buildWaUrl(phone, o.message_body), "_blank", "noopener,noreferrer");
      return { o, win, invalid: false };
    });

    let opened = 0, blocked = 0, invalidPhone = 0, markFailed = 0;
    for (const { o, win, invalid } of attempts) {
      if (invalid) { invalidPhone++; continue; }
      if (!win) { blocked++; continue; }
      opened++;
      try {
        await markOutgoingSent(o.id, "whatsapp");
      } catch {
        markFailed++;
      }
    }

    setSelected(new Set());
    const parts: string[] = [];
    if (opened)       parts.push(`${opened} opened`);
    if (blocked)      parts.push(`${blocked} blocked by your browser's pop-up blocker`);
    if (invalidPhone) parts.push(`${invalidPhone} missing/invalid number`);
    if (markFailed)   parts.push(`${markFailed} sent but couldn't be marked`);
    const msg = `WhatsApp: ${parts.join(", ")}.`;
    if (blocked || invalidPhone || markFailed) toast.warning(msg, { duration: 8000 });
    else toast.success(msg);
  }

  function itemsForOutgoing(outgoingId: string): Item[] {
    const itemIds = new Set(outgoingItems.filter((oi) => oi.outgoing_rfq_id === outgoingId).map((oi) => oi.item_id));
    return items.filter((i) => itemIds.has(i.id));
  }

  function toggleExpanded(outgoingId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(outgoingId)) next.delete(outgoingId);
      else next.add(outgoingId);
      return next;
    });
  }

  function updateOutgoingMessage(outgoingId: string, body: string) {
    setOutgoing((prev) => prev.map((o) => (o.id === outgoingId ? { ...o, message_body: body } : o)));
    markMessageDirty(outgoingId);
  }

  return (
    <main className="flex-1 p-8">

      {/* WhatsApp Group send modal */}
      {groupModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Send to WhatsApp Group</p>
                <p className="text-sm text-gray-500">{groupModal.supplierName}</p>
              </div>
            </div>

            {/* Steps */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold mb-1">WhatsApp groups don&apos;t support auto-fill</p>
              <p className="text-xs text-amber-700">Click <strong>Open Group</strong> — the message is auto-copied. When WhatsApp opens, click the text box and press <strong>Ctrl+V</strong> to paste, then send.</p>
              <p className="text-xs text-amber-700 mt-1.5">WhatsApp links can&apos;t auto-attach files — if this RFQ needs the original PDF/Excel attached, download it separately and attach it manually in WhatsApp before sending.</p>
            </div>

            {/* Message preview */}
            <div className="bg-gray-50 rounded-xl p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{groupModal.message}</pre>
            </div>

            <div className="flex gap-3">
              <button
                onClick={copyGroupMessage}
                className={`flex-1 h-10 flex items-center justify-center gap-2 text-sm font-semibold rounded-xl border-2 transition-colors ${
                  copied ? "border-green-400 bg-green-50 text-green-700" : "border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700"
                }`}
              >
                {copied ? <><CheckCircle className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Message</>}
              </button>
              <button
                onClick={confirmGroupSend}
                className="flex-1 h-10 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Open Group
              </button>
            </div>
            <button
              onClick={() => setGroupModal(null)}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* RFQ meta + lifecycle */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 min-w-0 flex-1">
            <RfqWorkflowTracker steps={workflowSteps} showLabels />
            {workflowComplete ? (
              <p className="text-sm font-medium text-green-700">Completed · Buyer notified</p>
            ) : (
              <p className="text-sm text-gray-500">
                Current step: <span className="font-medium text-gray-700">{workflowSteps.find((s) => s.state === "current")?.label}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLifecycleOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 shrink-0"
          >
            {lifecycleOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {lifecycleOpen ? "Hide details" : "Lifecycle details"}
          </button>
        </div>
        {lifecycleOpen && (
          <div className="pt-3 border-t border-gray-100">
            <RfqLifecycleExpand buyerLog={buyerLog} />
          </div>
        )}
        <div className="flex flex-wrap gap-6 pt-1 border-t border-gray-50">
        <div>
          <p className="text-xs text-gray-400 mb-1">Buyer</p>
          <p className="font-semibold text-gray-800">{rfq.buyer_name ?? "—"}</p>
          {rfq.buyer_email && <p className="text-sm text-gray-400">{rfq.buyer_email}</p>}
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Status</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle[rfq.status] ?? "bg-gray-100 text-gray-600"}`}>
            {rfq.status}
          </span>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Priority</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rfq.priority === "urgent" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
            {rfq.priority}
          </span>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">File</p>
          <p className="text-sm text-gray-600">{rfq.file_name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Items</p>
          <p className="font-semibold text-gray-800">{items.length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Date</p>
          <p className="text-sm text-gray-600">{new Date(rfq.created_at).toLocaleDateString("en-IN")}</p>
        </div>
        {rfq.source_rfq_number && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Source RFQ #</p>
            <p className="text-sm text-gray-600">{rfq.source_rfq_number}</p>
          </div>
        )}
        {rfq.source_date && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Source Date</p>
            <p className="text-sm text-gray-600">{rfq.source_date}</p>
          </div>
        )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="items">
        <TabsList className="mb-6">
          <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
          <TabsTrigger value="split">Supplier Split ({outgoing.length})</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="files">Files ({files?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Items ── */}
        <TabsContent value="items">
          {rfq.warnings && rfq.warnings.length > 0 && (
            <div className="mb-4 bg-yellow-50 text-yellow-800 text-xs px-4 py-3 rounded-xl space-y-1">
              {rfq.warnings.map((w, i) => (
                <div key={i} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {w}</div>
              ))}
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">Review and correct categories before splitting</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                  <button type="button" onClick={() => exportItemsToExcel(rfq, items)} disabled={items.length === 0}
                    title="Export Excel" className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 disabled:opacity-40 transition-colors">
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => exportItemsToCsv(rfq, items)} disabled={items.length === 0}
                    title="Export CSV" className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 border-l border-gray-200 disabled:opacity-40 transition-colors">
                    <Download className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => exportItemsToPdf(rfq, items)} disabled={items.length === 0}
                    title="Export PDF" className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 border-l border-gray-200 disabled:opacity-40 transition-colors">
                    <FileText className="w-4 h-4" />
                  </button>
                </div>
                <Button
                  onClick={handleSplit}
                  disabled={splitting || items.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  {splitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Split className="w-4 h-4" />}
                  {outgoing.length > 0 ? "Re-split by Supplier" : "Split by Supplier"}
                </Button>
              </div>
            </div>
            {splitError && (
              <div className="mx-6 mt-4 bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {splitError}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 w-8">#</th>
                  <th className="px-4 py-3">Item name</th>
                  <th className="px-4 py-3">Images</th>
                  <th className="px-4 py-3">Part / SKU</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Spec</th>
                  <th className="px-4 py-3">Colour</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => {
                  const images = itemImages.filter((img) => img.item_id === item.id);
                  const overallConfidence = item.confidence ?? item.category_confidence ?? 0;
                  return (
                  <tr key={item.id} className={cn("hover:bg-gray-50", item.flagged && "bg-yellow-50/40")}>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{item.line_number}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-1.5">
                        <div>
                          <p className="font-medium text-gray-800">{item.name}</p>
                          {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                          {item.source_files && item.source_files.length > 0 ? (
                            <p className="text-[10px] text-blue-500 mt-0.5 truncate max-w-[220px]" title={item.source_files.join(", ")}>
                              from {item.source_files.join(", ")}
                            </p>
                          ) : (item.merged_from_count ?? 1) > 1 && (
                            <p className="text-[10px] text-blue-500 mt-0.5">merged from {item.merged_from_count} source files</p>
                          )}
                        </div>
                        {item.warnings && item.warnings.length > 0 && (
                          <span title={item.warnings.join(" ")}>
                            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {images.length > 0 ? (
                        <div className="flex -space-x-2">
                          {images.slice(0, 3).map((img) => (
                            img.signedUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={img.id} src={img.signedUrl} alt={img.source_file_name ?? "item photo"}
                                className="w-8 h-8 rounded-lg object-cover border-2 border-white shadow-sm" />
                            ) : (
                              <div key={img.id} className="w-8 h-8 rounded-lg bg-gray-100 border-2 border-white flex items-center justify-center">
                                <ImageOff className="w-3 h-3 text-gray-300" />
                              </div>
                            )
                          ))}
                          {images.length > 3 && (
                            <div className="w-8 h-8 rounded-lg bg-gray-100 border-2 border-white flex items-center justify-center text-[10px] text-gray-500 font-medium">
                              +{images.length - 3}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{item.part_number ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {item.qty != null ? `${item.qty} ${item.unit ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[140px] truncate">{item.spec ?? "—"}</td>
                    <td className="px-4 py-3">
                      <ColourCell item={item} onSave={updateColour} />
                    </td>
                    <td className="px-4 py-3">
                      <CategoryCell item={item} onSave={updateCategory} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", overallConfidence >= 0.7 ? "bg-green-400" : "bg-yellow-400")}
                            style={{ width: `${overallConfidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">{Math.round(overallConfidence * 100)}%</span>
                        {item.flagged && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Images that couldn't be confidently matched to a line item */}
          {itemImages.some((img) => !img.item_id) && (
            <div className="mt-4 bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-sm font-medium text-gray-700 mb-3">Unassigned Images</p>
              <div className="flex flex-wrap gap-3">
                {itemImages.filter((img) => !img.item_id).map((img) => (
                  <div key={img.id} className="w-20 text-center">
                    {img.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.signedUrl} alt={img.source_file_name ?? "unassigned"}
                        className="w-20 h-20 rounded-lg object-cover border border-gray-100" />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-gray-100 flex items-center justify-center">
                        <ImageOff className="w-5 h-5 text-gray-300" />
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 truncate mt-1">{img.source_file_name ?? "image"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 2: Supplier Split ── */}
        <TabsContent value="split">
          {outgoing.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 text-center">
              <Package className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-gray-400 font-medium">No split yet</p>
              <p className="text-gray-400 text-sm mt-1 mb-4">Go to the Items tab and click &quot;Split by Supplier&quot;</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Select all toolbar */}
              <div className="bg-white rounded-xl border border-gray-100 px-4 py-2.5 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                    checked={selected.size === outgoing.filter(o => o.status !== "sent").length && outgoing.filter(o => o.status !== "sent").length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(outgoing.filter(o => o.status !== "sent").map(o => o.id)));
                      } else {
                        setSelected(new Set());
                      }
                    }}
                  />
                  <span className="text-sm text-gray-600">
                    {selected.size === 0 ? "Select suppliers to send" : `${selected.size} supplier${selected.size > 1 ? "s" : ""} selected`}
                  </span>
                </div>
                {selected.size > 0 && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const targets = outgoing.filter(o => selected.has(o.id) && o.suppliers?.whatsapp_number);
                        if (targets.length === 0) { toast.error("None of the selected suppliers have a WhatsApp number."); return; }
                        handleBulkWhatsappSend(targets);
                      }}
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-8 text-xs"
                    >
                      <MessageCircle className="w-3 h-3" /> Send WhatsApp to selected
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const groupOnes = outgoing.filter(o => selected.has(o.id) && isValidWhatsappGroupLink(o.suppliers?.whatsapp_group_link));
                        if (groupOnes.length === 0) { toast.error("None of the selected suppliers have a valid WhatsApp group link."); return; }
                        // Groups can't be auto-sent (no prefill support) — open the
                        // first one and tell the user how many more to repeat for.
                        const o = groupOnes[0];
                        openGroupModal(o.id, o.suppliers!.whatsapp_group_link!, o.message_body, o.suppliers!.name);
                        if (groupOnes.length > 1) {
                          toast.info(`Opening group 1 of ${groupOnes.length} — repeat "Send to Groups" for the other ${groupOnes.length - 1} after this one.`, { duration: 8000 });
                        }
                        setSelected(new Set());
                      }}
                      className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5 h-8 text-xs"
                    >
                      <Users className="w-3 h-3" /> Send to Groups
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(new Set())}
                      className="h-8 text-xs"
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>

              {outgoing.map((o) => {
                const supplierItems = itemsForOutgoing(o.id);
                const isSending = sending === o.id;
                const isSelected = selected.has(o.id);
                const isSent = o.status === "sent";
                return (
                  <SupplierSplitCard
                    key={o.id}
                    outgoing={o}
                    supplierItems={supplierItems}
                    isSending={isSending}
                    isSelected={isSelected}
                    isSent={isSent}
                    isExpanded={expanded.has(o.id)}
                    onToggleExpand={() => toggleExpanded(o.id)}
                    onSelect={(checked) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(o.id);
                        else next.delete(o.id);
                        return next;
                      });
                    }}
                    onMessageChange={(body) => updateOutgoingMessage(o.id, body)}
                    onSend={(channel, whatsappNumber) =>
                      handleSend(o.id, channel, whatsappNumber, o.message_body)
                    }
                    onOpenGroup={() =>
                      openGroupModal(
                        o.id,
                        o.suppliers!.whatsapp_group_link!,
                        o.message_body,
                        o.suppliers!.name,
                      )
                    }
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: Status ── */}
        <TabsContent value="status">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {outgoing.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-gray-400">
                <Send className="w-10 h-10 text-gray-200 mb-3" />
                <p className="font-medium">No outgoing RFQs yet</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                    <th className="px-6 py-3">Code</th>
                    <th className="px-6 py-3">Supplier</th>
                    <th className="px-6 py-3">Category</th>
                    <th className="px-6 py-3">Channel</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Sent at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {outgoing.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-700">{o.child_code}</td>
                      <td className="px-6 py-3 text-gray-600">{o.suppliers?.name ?? <span className="text-yellow-600">No supplier</span>}</td>
                      <td className="px-6 py-3 text-gray-500 text-xs">{o.category.replace(/_/g, " ")}</td>
                      <td className="px-6 py-3 text-gray-500 capitalize">{o.channel}</td>
                      <td className="px-6 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle[o.status]}`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-xs">
                        {o.sent_at ? new Date(o.sent_at).toLocaleString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── TAB 4: Files — every source this RFQ was built from (each real
            attachment plus, when present, the email body itself), so it's
            visible at a glance which files were actually scanned and which
            failed, instead of that only being inferable from item counts
            and warning text. ── */}
        <TabsContent value="files">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {!files || files.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-gray-400">
                <FileText className="w-10 h-10 text-gray-200 mb-3" />
                <p className="font-medium">No source files recorded for this RFQ</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                    <th className="px-6 py-3">File</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Scan status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {files.map((f) => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-700">{f.file_name}</td>
                      <td className="px-6 py-3 text-gray-500 text-xs uppercase">{f.file_type}</td>
                      <td className="px-6 py-3">
                        {f.status === "parsed" ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-50 text-green-700">
                            <CheckCircle className="w-3 h-3" /> Scanned
                          </span>
                        ) : f.status === "failed" ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-700"
                            title={f.error ?? undefined}
                          >
                            <AlertTriangle className="w-3 h-3" /> Failed{f.error ? ` — ${f.error}` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                            <Loader2 className="w-3 h-3" /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
