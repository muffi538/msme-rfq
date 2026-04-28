"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Upload, AlertTriangle, ChevronUp, ChevronDown, X, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const statusStyle: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800 border-yellow-200",
  processing: "bg-blue-100 text-blue-800 border-blue-200",
  processed:  "bg-green-100 text-green-800 border-green-200",
  approved:   "bg-indigo-100 text-indigo-800 border-indigo-200",
  sent:       "bg-gray-100 text-gray-700 border-gray-200",
};

type Rfq = {
  id: string;
  rfq_code: string;
  buyer_name: string | null;
  buyer_email: string | null;
  status: string;
  priority: string;
  file_type: string | null;
  created_at: string;
};

type SortDir = "desc" | "asc";

const ALL_STATUSES = ["pending", "processing", "processed", "approved", "sent"];
const ALL_PRIORITIES = ["normal", "urgent"];

export default function RfqsClient({ rfqs: initial }: { rfqs: Rfq[] }) {
  const [rfqs,          setRfqs]          = useState<Rfq[]>(initial);
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState<string | null>(null);
  const [priorityFilter,setPriorityFilter]= useState<string | null>(null);
  const [sortDir,       setSortDir]       = useState<SortDir>("desc");
  const [deleteTarget,  setDeleteTarget]  = useState<Rfq | null>(null);
  const [deleting,      setDeleting]      = useState(false);

  const filtered = useMemo(() => {
    let list = [...rfqs];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.rfq_code.toLowerCase().includes(q) ||
          (r.buyer_name ?? "").toLowerCase().includes(q) ||
          (r.buyer_email ?? "").toLowerCase().includes(q)
      );
    }

    if (statusFilter)    list = list.filter((r) => r.status   === statusFilter);
    if (priorityFilter)  list = list.filter((r) => r.priority === priorityFilter);

    list.sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortDir === "desc" ? -diff : diff;
    });

    return list;
  }, [rfqs, search, statusFilter, priorityFilter, sortDir]);

  const hasActiveFilter = search || statusFilter || priorityFilter;

  function clearFilters() {
    setSearch("");
    setStatusFilter(null);
    setPriorityFilter(null);
  }

  function exportToExcel() {
    const rows = filtered.map((r) => ({
      "RFQ Code":    r.rfq_code,
      "Buyer Name":  r.buyer_name ?? "",
      "Buyer Email": r.buyer_email ?? "",
      "Type":        r.file_type ?? "",
      "Status":      r.status,
      "Priority":    r.priority,
      "Date":        new Date(r.created_at).toLocaleDateString("en-IN"),
      "Time":        new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 18 }, { wch: 28 }, { wch: 34 },
      { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 12 }, { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RFQs");

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `RFQs-${date}.xlsx`);
    toast.success(`Exported ${rows.length} RFQ${rows.length !== 1 ? "s" : ""} to Excel`);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/rfqs/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setRfqs((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      toast.success(`${deleteTarget.rfq_code} deleted`);
      setDeleteTarget(null);
    } catch {
      toast.error("Could not delete RFQ");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Delete RFQ?</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  <strong>{deleteTarget.rfq_code}</strong> and all its items will be permanently removed.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 h-10 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search buyer or RFQ code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
        />

        <select
          value={statusFilter ?? ""}
          onChange={(e) => setStatusFilter(e.target.value || null)}
          className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <div className="flex gap-1.5">
          {ALL_PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(priorityFilter === p ? null : p)}
              className={`h-9 px-3 text-sm rounded-lg border font-medium transition-colors capitalize ${
                priorityFilter === p
                  ? p === "urgent"
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 flex items-center gap-1.5 text-gray-600 transition-colors"
        >
          Date
          {sortDir === "desc" ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            className="h-9 px-3 text-sm text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}

        <span className="text-sm text-gray-400">{filtered.length} RFQ{filtered.length !== 1 ? "s" : ""}</span>

        <button
          onClick={exportToExcel}
          disabled={filtered.length === 0}
          className="ml-auto h-9 px-4 text-sm border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Export Excel
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Upload className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-gray-400 font-medium">
              {hasActiveFilter ? "No RFQs match your filters" : "No RFQs uploaded yet"}
            </p>
            {!hasActiveFilter && (
              <Link href="/rfqs/upload" className="mt-4 text-blue-600 text-sm font-medium hover:underline">
                Upload your first RFQ →
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                <th className="px-6 py-3">RFQ Code</th>
                <th className="px-6 py-3">Buyer</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Priority</th>
                <th className="px-6 py-3">Date &amp; Time</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((rfq) => (
                <tr key={rfq.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-6 py-3 font-semibold text-blue-600">
                    <Link href={`/rfqs/${rfq.id}`} target="_blank" className="hover:underline flex items-center gap-1 group">
                      {rfq.rfq_code}
                      <svg className="w-3 h-3 text-gray-300 group-hover:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-gray-800 font-medium">{rfq.buyer_name ?? "—"}</p>
                    {rfq.buyer_email && (
                      <p className="text-gray-400 text-xs">{rfq.buyer_email}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-500 capitalize">{rfq.file_type ?? "—"}</td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${statusStyle[rfq.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {rfq.status}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {rfq.priority === "urgent" && (
                      <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                        <AlertTriangle className="w-3 h-3" /> urgent
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-400 whitespace-nowrap">
                    <p>{new Date(rfq.created_at).toLocaleDateString("en-IN")}</p>
                    <p className="text-xs">{new Date(rfq.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => setDeleteTarget(rfq)}
                      className="text-gray-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete RFQ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
