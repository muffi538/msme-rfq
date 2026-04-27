"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Split, Send, CheckCircle, AlertTriangle,
  MessageCircle, Mail, Package
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CATEGORIES = [
  "POWER_TOOLS","HAND_TOOLS","FURNITURE_FITTINGS","SAFETY_ITEMS",
  "FASTENERS","SANITARY_PLUMBING","PAINTS","VALVES_FITTINGS",
  "PACKAGING_MATERIALS","ELECTRICAL","HVAC","GENERAL_HARDWARE",
];

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
  suppliers: { name: string; whatsapp_number: string | null; email: string | null } | null;
};

type OutgoingItem = { outgoing_rfq_id: string; item_id: string };

type Rfq = {
  id: string; rfq_code: string; buyer_name: string | null;
  buyer_email: string | null; status: string; priority: string;
  file_name: string | null; created_at: string;
};

export default function RfqDetailClient({
  rfq, items: initialItems, outgoing: initialOutgoing, outgoingItems,
}: {
  rfq: Rfq;
  items: Item[];
  outgoing: OutgoingRfq[];
  outgoingItems: OutgoingItem[];
}) {
  const [items, setItems]     = useState<Item[]>(initialItems);
  const [outgoing, setOutgoing] = useState<OutgoingRfq[]>(initialOutgoing);
  const [splitting, setSplitting] = useState(false);
  const [sending, setSending]     = useState<string | null>(null);
  const [splitError, setSplitError] = useState("");

  // --- Update item category ---
  async function updateCategory(itemId: string, category: string) {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, category } : i));
    await fetch(`/api/rfqs/${rfq.id}/item`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, category }),
    });
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
  async function handleSend(outgoingId: string, channel: string, whatsappNumber?: string | null, message?: string | null) {
    setSending(outgoingId);
    try {
      if (channel === "whatsapp" && whatsappNumber) {
        // Open WhatsApp Web with pre-filled message
        const phone = whatsappNumber.replace(/[^0-9]/g, "");
        const text  = encodeURIComponent(message ?? "");
        window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
        toast.success("WhatsApp opened — send the message to complete.");
      } else {
        toast.info("Email channel — marking as sent.");
      }

      // Mark as sent in DB
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

  // Which items belong to an outgoing RFQ
  function itemsForOutgoing(outgoingId: string): Item[] {
    const itemIds = new Set(outgoingItems.filter((oi) => oi.outgoing_rfq_id === outgoingId).map((oi) => oi.item_id));
    return items.filter((i) => itemIds.has(i.id));
  }

  return (
    <main className="flex-1 p-8">
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
                    <td className="px-4 py-2.5">
                      <Select value={item.category ?? "GENERAL_HARDWARE"} onValueChange={(v) => v && updateCategory(item.id, v)}>
                        <SelectTrigger className="h-7 text-xs w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c} className="text-xs">
                              {c.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
              {outgoing.map((o) => {
                const supplierItems = itemsForOutgoing(o.id);
                const isSending = sending === o.id;
                return (
                  <div key={o.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    {/* Card header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
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
                        {o.status !== "sent" && o.suppliers && (
                          <div className="flex gap-2">
                            {o.suppliers.whatsapp_number && (
                              <Button
                                size="sm"
                                onClick={() => handleSend(o.id, "whatsapp", o.suppliers?.whatsapp_number, o.message_body)}
                                disabled={isSending}
                                className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-8 text-xs"
                              >
                                {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
                                Send on WhatsApp
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
                        {o.status === "sent" && (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle className="w-4 h-4" /> Sent
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Items in this split */}
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

                    {/* Message preview */}
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
