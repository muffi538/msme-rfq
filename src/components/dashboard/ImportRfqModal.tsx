"use client";

import { useState, useMemo } from "react";
import { Search, X, FileText, Loader2, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImportableRfq = {
  id: string;
  rfq_code: string;
  buyer_name: string | null;
  buyer_email: string | null;
  status: string;
  created_at: string;
  supplier_names: string[];
  has_draft: boolean;
};

const STATUS_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "processed",  label: "Processed",  statuses: ["processed", "approved"] },
  { key: "sent",       label: "Sent",       statuses: ["sent"] },
  { key: "quotation",  label: "Quotation Sent", statuses: ["quotation_sent", "under_evaluation", "po_received"] },
  { key: "failed",     label: "Failed",     statuses: ["failed", "cancelled"] },
];

const statusStyle: Record<string, string> = {
  processed:        "bg-green-50 text-green-700 border border-green-200",
  approved:         "bg-indigo-50 text-indigo-700 border border-indigo-200",
  sent:             "bg-gray-100 text-gray-600 border border-gray-200",
  quotation_sent:   "bg-purple-50 text-purple-700 border border-purple-200",
  under_evaluation: "bg-amber-50 text-amber-700 border border-amber-200",
  po_received:      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  failed:           "bg-red-50 text-red-700 border border-red-200",
  cancelled:        "bg-red-50 text-red-700 border border-red-200",
};

// Searchable "Import Existing RFQ" picker — lists every already-processed
// RFQ (same scope as the main RFQs list, /rfqs/page.tsx) so a quotation
// reply can be built from an RFQ's known item list instead of re-uploading
// a fresh document for something already in the system. Search covers RFQ
// No., Customer (buyer), Supplier (from that RFQ's outgoing/supplier
// split, if any), and Status; Date drives the default newest-first sort.
export function ImportRfqModal({
  rfqs,
  onSelect,
  onClose,
}: {
  rfqs: ImportableRfq[];
  onSelect: (rfqId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const activeGroup = STATUS_GROUPS.find((g) => g.key === statusFilter);
  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return rfqs
      .filter((r) => {
        if (activeGroup && !activeGroup.statuses.includes(r.status)) return false;
        if (!q) return true;
        return (
          r.rfq_code.toLowerCase().includes(q) ||
          r.buyer_name?.toLowerCase().includes(q) ||
          r.buyer_email?.toLowerCase().includes(q) ||
          r.supplier_names.some((s) => s.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [rfqs, q, activeGroup]);

  function handleSelect(rfqId: string) {
    setLoadingId(rfqId);
    onSelect(rfqId);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Import Existing RFQ</h2>
            <p className="text-sm text-gray-400 mt-0.5">Pick an RFQ already in Procur.AI to price and reply to</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              type="text"
              placeholder="Search RFQ No., customer, or supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            {STATUS_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rfqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <FileText className="w-8 h-8 text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium text-sm">No RFQs yet</p>
              <p className="text-gray-400 text-xs mt-1">Process an RFQ first, then it&apos;ll be available to import here.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Search className="w-8 h-8 text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium text-sm">No RFQs match your search</p>
              <button onClick={() => { setSearch(""); setStatusFilter(""); }} className="text-blue-600 text-xs mt-1 hover:underline">
                Clear filters
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {filtered.map((rfq) => (
                  <tr
                    key={rfq.id}
                    onClick={() => !loadingId && handleSelect(rfq.id)}
                    className={cn(
                      "hover:bg-blue-50/50 cursor-pointer transition-colors",
                      loadingId === rfq.id && "bg-blue-50/50"
                    )}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-blue-600">{rfq.rfq_code}</span>
                        {rfq.has_draft && (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                            <PenLine className="w-2.5 h-2.5" /> Draft in progress
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5">{rfq.buyer_name ?? "—"}</p>
                      {rfq.supplier_names.length > 0 && (
                        <p className="text-gray-400 text-xs">Supplier: {rfq.supplier_names.join(", ")}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap", statusStyle[rfq.status] ?? "bg-gray-100 text-gray-600 border border-gray-200")}>
                        {rfq.status.replace(/_/g, " ")}
                      </span>
                      <p className="text-gray-400 text-xs mt-1">
                        {new Date(rfq.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </td>
                    <td className="pr-4 py-3 w-8">
                      {loadingId === rfq.id && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
