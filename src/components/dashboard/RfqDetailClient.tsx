"use client";

import { useState, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Loader2, Split, Send, CheckCircle, AlertTriangle,
  MessageCircle, Mail, Package, Pencil, Copy, ExternalLink, Users
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PRESET_CATEGORIES = [
  "POWER_TOOLS","HAND_TOOLS","FURNITURE_FITTINGS","SAFETY_ITEMS",
  "FASTENERS","SANITARY_PLUMBING","PAINTS","VALVES_FITTINGS",
  "PACKAGING_MATERIALS","ELECTRICAL","HVAC","GENERAL_HARDWARE",
];

const CUSTOM_VALUE = "__CUSTOM__";

/* ── WhatsApp helpers ──────────────────────────────────────────────
 * normalizePhone: strip non-digits and add India's +91 country code
 * if the user saved the number without one. wa.me silently fails on
 * a 10-digit local number — it must be in international form.
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  // 10-digit Indian mobile → prepend 91
  if (digits.length === 10) return `91${digits}`;
  // 11 digits starting with 0 → drop the 0, prepend 91
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

function buildWaUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

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
};

type OutgoingRfq = {
  id: string; child_code: string; category: string; message_body: string;
  channel: string; status: string; sent_at: string | null;
  suppliers: { name: string; whatsapp_number: string | null; whatsapp_group_link: string | null; email: string | null } | null;
};

type OutgoingItem = { outgoing_rfq_id: string; item_id: string };

type Rfq = {
  id: string; rfq_code: string; buyer_name: string | null;
  buyer_email: string | null; status: string; priority: string;
  file_name: string | null; created_at: string;
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
        <SelectValue />
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

export default function RfqDetailClient({
  rfq, items: initialItems, outgoing: initialOutgoing, outgoingItems,
}: {
  rfq: Rfq;
  items: Item[];
  outgoing: OutgoingRfq[];
  outgoingItems: OutgoingItem[];
}) {
  const [items, setItems]         = useState<Item[]>(initialItems);
  const [outgoing, setOutgoing]   = useState<OutgoingRfq[]>(initialOutgoing);
  const [splitting, setSplitting] = useState(false);
  const [sending, setSending]     = useState<string | null>(null);
  const [splitError, setSplitError] = useState("");
  const [selected, setSelected]   = useState<Set<string>>(new Set());

  // Group send modal
  const [groupModal, setGroupModal] = useState<{ outgoingId: string; groupLink: string; message: string; supplierName: string } | null>(null);
  const [copied, setCopied]         = useState(false);

  // --- Update item category ---
  async function updateCategory(itemId: string, category: string) {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, category } : i));
    await fetch(`/api/rfqs/${rfq.id}/item`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, category }),
    });
    toast.success(`Category updated to "${category.replace(/_/g, " ")}"`);
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
    setGroupModal({ outgoingId, groupLink, message, supplierName });
    setCopied(false);
  }

  async function copyGroupMessage() {
    if (!groupModal) return;
    await navigator.clipboard.writeText(groupModal.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function confirmGroupSend() {
    if (!groupModal) return;
    const { outgoingId } = groupModal;

    // ⚠️ window.open MUST run synchronously inside the click handler — any
    // `await` before it causes Chrome/Safari to flag it as a programmatic
    // pop-up and silently block it. So open the group FIRST, do everything
    // else after.
    const newWin = window.open(groupModal.groupLink, "_blank", "noopener,noreferrer");
    if (!newWin) {
      toast.error("Pop-up blocked — please allow pop-ups for this site, then try again.");
      return;
    }

    // Now safe to do async work
    try { await navigator.clipboard.writeText(groupModal.message); } catch { /* ignore */ }

    toast.success("✅ Message copied! Click the text box in the group and press Ctrl+V to paste.", { duration: 6000 });

    // Mark as sent
    const res = await fetch(`/api/rfqs/${rfq.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outgoingId, channel: "whatsapp" }),
    });
    if (res.ok) {
      setOutgoing((prev) =>
        prev.map((o) => o.id === outgoingId ? { ...o, status: "sent", sent_at: new Date().toISOString() } : o)
      );
    }
    setGroupModal(null);
  }

  async function handleSend(outgoingId: string, channel: string, whatsappNumber?: string | null, message?: string | null, groupLink?: string | null, supplierName?: string) {
    setSending(outgoingId);
    try {
      if (channel === "whatsapp_group" && groupLink) {
        setSending(null);
        openGroupModal(outgoingId, groupLink, message ?? "", supplierName ?? "Supplier");
        return;
      } else if (channel === "whatsapp" && whatsappNumber) {
        const phone = normalizePhone(whatsappNumber);
        if (!phone) {
          toast.error("This supplier has no valid WhatsApp number. Add one in Suppliers.");
          setSending(null);
          return;
        }
        const newWin = window.open(buildWaUrl(phone, message ?? ""), "_blank", "noopener,noreferrer");
        if (!newWin) {
          toast.error("Pop-up blocked — please allow pop-ups for this site, then try again.");
          setSending(null);
          return;
        }
        toast.success("WhatsApp opened — tap Send in WhatsApp to deliver the message.");
      } else if (channel === "whatsapp" || channel === "whatsapp_group") {
        toast.error("This supplier is missing a WhatsApp number or group link. Update them in Suppliers.");
        setSending(null);
        return;
      } else {
        toast.info("Email channel — marking as sent.");
      }
      const res = await fetch(`/api/rfqs/${rfq.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outgoingId, channel }),
      });
      if (res.ok) {
        setOutgoing((prev) =>
          prev.map((o) => o.id === outgoingId ? { ...o, status: "sent", sent_at: new Date().toISOString() } : o)
        );
      }
    } catch {
      toast.error("Could not mark as sent. Please try again.");
    } finally {
      setSending(null);
    }
  }

  function itemsForOutgoing(outgoingId: string): Item[] {
    const itemIds = new Set(outgoingItems.filter((oi) => oi.outgoing_rfq_id === outgoingId).map((oi) => oi.item_id));
    return items.filter((i) => itemIds.has(i.id));
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

      {/* RFQ meta */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 flex flex-wrap gap-6">
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
      </div>

      {/* Tabs */}
      <Tabs defaultValue="items">
        <TabsList className="mb-6">
          <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
          <TabsTrigger value="split">Supplier Split ({outgoing.length})</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Items ── */}
        <TabsContent value="items">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <p className="text-sm text-gray-500">Review and correct categories before splitting</p>
              <Button
                onClick={handleSplit}
                disabled={splitting || items.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                {splitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Split className="w-4 h-4" />}
                {outgoing.length > 0 ? "Re-split by Supplier" : "Split by Supplier"}
              </Button>
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
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Spec</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => (
                  <tr key={item.id} className={cn("hover:bg-gray-50", item.flagged && "bg-yellow-50/40")}>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{item.line_number}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800">{item.name}</p>
                      {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {item.qty != null ? `${item.qty} ${item.unit ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[140px] truncate">{item.spec ?? "—"}</td>
                    <td className="px-4 py-3">
                      <CategoryCell item={item} onSave={updateCategory} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", (item.category_confidence ?? 0) >= 0.7 ? "bg-green-400" : "bg-yellow-400")}
                            style={{ width: `${(item.category_confidence ?? 0) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">{Math.round((item.category_confidence ?? 0) * 100)}%</span>
                        {item.flagged && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── TAB 2: Supplier Split ── */}
        <TabsContent value="split">
          {outgoing.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 text-center">
              <Package className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-gray-400 font-medium">No split yet</p>
              <p className="text-gray-400 text-sm mt-1 mb-4">Go to the Items tab and click "Split by Supplier"</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Select all toolbar */}
              <div className="bg-white rounded-2xl border border-gray-100 px-5 py-3 flex items-center justify-between">
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
                        outgoing.filter(o => selected.has(o.id) && o.suppliers?.whatsapp_number).forEach(o => {
                          handleSend(o.id, "whatsapp", o.suppliers?.whatsapp_number, o.message_body);
                        });
                        setSelected(new Set());
                      }}
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-8 text-xs"
                    >
                      <MessageCircle className="w-3 h-3" /> Send WhatsApp to selected
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const groupOnes = outgoing.filter(o => selected.has(o.id) && o.suppliers?.whatsapp_group_link);
                        if (groupOnes.length > 0) {
                          // Open first one — user handles each group sequentially
                          const o = groupOnes[0];
                          openGroupModal(o.id, o.suppliers!.whatsapp_group_link!, o.message_body, o.suppliers!.name);
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
                  <div key={o.id} className={cn("bg-white rounded-2xl border overflow-hidden transition-colors", isSelected ? "border-blue-300 ring-1 ring-blue-200" : "border-gray-100")}>
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
                      <div className="flex items-center gap-3">
                        {/* Checkbox */}
                        {!isSent && (
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded accent-blue-600 cursor-pointer flex-shrink-0"
                            checked={isSelected}
                            onChange={(e) => {
                              setSelected(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(o.id);
                                else next.delete(o.id);
                                return next;
                              });
                            }}
                          />
                        )}
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Package className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">
                            {o.suppliers?.name ?? "No supplier matched"}
                          </p>
                          <p className="text-xs text-gray-400">
                            {o.child_code} · {o.category.replace(/_/g, " ")} · {supplierItems.length} items
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle[o.status]}`}>
                          {o.status}
                        </span>
                        {!isSent && o.suppliers && (
                          <div className="flex gap-2 flex-wrap">
                            {o.suppliers.whatsapp_number && (
                              <Button
                                size="sm"
                                onClick={() => handleSend(o.id, "whatsapp", o.suppliers?.whatsapp_number, o.message_body)}
                                disabled={isSending}
                                className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-8 text-xs"
                              >
                                {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
                                WhatsApp
                              </Button>
                            )}
                            {o.suppliers.whatsapp_group_link && (
                              <Button
                                size="sm"
                                onClick={() => openGroupModal(o.id, o.suppliers!.whatsapp_group_link!, o.message_body, o.suppliers!.name)}
                                disabled={isSending}
                                className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5 h-8 text-xs"
                              >
                                <Users className="w-3 h-3" /> Group
                              </Button>
                            )}
                            {o.suppliers.email && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSend(o.id, "email")}
                                disabled={isSending}
                                className="gap-1.5 h-8 text-xs"
                              >
                                {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                                Email
                              </Button>
                            )}
                          </div>
                        )}
                        {isSent && (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle className="w-4 h-4" /> Sent
                          </span>
                        )}
                      </div>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                          <th className="px-6 py-2">Item</th>
                          <th className="px-6 py-2">Qty</th>
                          <th className="px-6 py-2">Spec</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {supplierItems.map((item) => (
                          <tr key={item.id}>
                            <td className="px-6 py-2 font-medium text-gray-800">{item.name}</td>
                            <td className="px-6 py-2 text-gray-500">{item.qty != null ? `${item.qty} ${item.unit ?? ""}` : "—"}</td>
                            <td className="px-6 py-2 text-gray-400 text-xs">{item.spec ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {o.message_body && (
                      <div className="px-6 py-4 border-t border-gray-50 bg-gray-50/50">
                        <p className="text-xs text-gray-400 mb-1 font-medium">Message preview</p>
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">{o.message_body}</pre>
                      </div>
                    )}
                  </div>
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
      </Tabs>
    </main>
  );
}
