"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, ArrowRight, Search } from "lucide-react";

type RecentRfq = {
  id: string;
  rfq_code: string;
  buyer_name: string | null;
  status: string;
  priority: string | null;
  created_at: string;
};

const statusStyle: Record<string, string> = {
  pending:    "bg-amber-50 text-amber-700 border border-amber-200",
  processing: "bg-[#1847F5]/8 text-[#1847F5] border border-[#1847F5]/20",
  processed:  "bg-green-50 text-green-700 border border-green-200",
  approved:   "bg-indigo-50 text-indigo-700 border border-indigo-200",
  sent:       "bg-gray-100 text-gray-600 border border-gray-200",
};

// This card's query (dashboard/page.tsx) already excludes pending/
// needs_processing RFQs — those live in the Inbox, not here — so there's
// no "Pending" group to offer; only what can actually appear in this list.
const STATUS_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "in_progress", label: "In Progress", statuses: ["processing"] },
  { key: "completed",   label: "Completed",   statuses: ["processed", "approved", "sent"] },
  { key: "failed",      label: "Failed",      statuses: ["failed", "cancelled"] },
];

// Client component so the Recent RFQs card can offer a quick search/filter
// over the handful of rows the dashboard already loaded — dashboard/page.tsx
// itself stays a server component; only this card needs interactivity.
export default function RecentRfqsCard({ rfqs }: { rfqs: RecentRfq[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const q = search.trim().toLowerCase();
  const activeGroup = STATUS_GROUPS.find((g) => g.key === statusFilter);
  const filtered = rfqs.filter((r) => {
    if (q && !(r.rfq_code.toLowerCase().includes(q) || r.buyer_name?.toLowerCase().includes(q))) return false;
    if (activeGroup && !activeGroup.statuses.includes(r.status)) return false;
    return true;
  });
  const hasActiveFilter = q || statusFilter;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">

      {/* Section header — chapter label style */}
      <div className="flex items-center justify-between px-7 py-5 border-b border-border gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-3.5 w-px bg-[#1847F5]" />
          <h2 className="font-semibold text-card-foreground text-sm tracking-tight">Recent RFQs</h2>
        </div>
        <div className="flex items-center gap-3">
          {rfqs.length > 0 && (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search RFQ code or buyer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 pr-3 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#1847F5] w-48"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 px-2.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#1847F5] text-card-foreground"
              >
                <option value="">All statuses</option>
                {STATUS_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
              </select>
              {hasActiveFilter && (
                <button
                  onClick={() => { setSearch(""); setStatusFilter(""); }}
                  className="text-xs text-muted-foreground hover:text-[#1847F5] transition-colors whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </>
          )}
          <Link
            href="/rfqs"
            className="text-xs text-muted-foreground hover:text-[#1847F5] flex items-center gap-1 transition-colors font-medium whitespace-nowrap"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {rfqs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground font-medium text-sm">No RFQs yet</p>
          <p className="text-muted-foreground/70 text-xs mt-1 mb-5">Upload your first RFQ to get started</p>
          <Link
            href="/rfqs/upload"
            className="bg-[#1847F5] hover:bg-[#0f35d4] text-white text-xs font-semibold px-5 py-2.5 rounded-full transition-colors shadow-[0_2px_8px_rgba(24,71,245,0.35)]"
          >
            Upload RFQ
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground font-medium text-sm">
            {q && activeGroup ? `No "${activeGroup.label}" RFQs match "${search}"` : q ? `No RFQs match "${search}"` : `No "${activeGroup?.label}" RFQs`}
          </p>
          <button onClick={() => { setSearch(""); setStatusFilter(""); }} className="text-[#1847F5] text-xs mt-1 hover:underline">Clear filters</button>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["RFQ Code", "Buyer", "Status", "Priority", "Date"].map((h) => (
                <th key={h} className="px-7 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((rfq) => (
              <tr key={rfq.id} className="hover:bg-accent/40 transition-colors">
                <td className="px-7 py-4 font-semibold text-[#1847F5]">
                  <Link href={`/rfqs/${rfq.id}`} className="hover:underline underline-offset-2">
                    {rfq.rfq_code}
                  </Link>
                </td>
                <td className="px-7 py-4 text-muted-foreground">{rfq.buyer_name ?? "—"}</td>
                <td className="px-7 py-4">
                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${statusStyle[rfq.status] ?? "bg-muted text-muted-foreground border border-border"}`}>
                    {rfq.status}
                  </span>
                </td>
                <td className="px-7 py-4">
                  {rfq.priority === "urgent" && (
                    <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold bg-red-50 text-red-700 border border-red-200">urgent</span>
                  )}
                </td>
                <td className="px-7 py-4 text-muted-foreground/70 whitespace-nowrap text-xs">
                  <p className="font-medium text-muted-foreground">{new Date(rfq.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                  <p>{new Date(rfq.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
