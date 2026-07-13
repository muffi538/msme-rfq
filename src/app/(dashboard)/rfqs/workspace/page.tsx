"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqDetailClient from "@/components/dashboard/RfqDetailClient";
import { createClient } from "@/lib/supabase/client";
import { fetchRfqDetail } from "@/lib/fetchRfqDetail";
import { computeWorkflowSteps, isWorkflowComplete } from "@/lib/rfq-lifecycle";
import { cn } from "@/lib/utils";
import { X, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from "lucide-react";

const STORAGE_KEY = "rfq-workspace-open-ids";

type RfqDetail = Awaited<ReturnType<typeof fetchRfqDetail>>;
type TabState = { status: "loading" | "ready" | "error"; error?: string; data?: RfqDetail };
type BadgeStatus = "Processing" | "Ready" | "Reviewed" | "Sent" | "Completed" | "Error";

// "Reviewed" has no dedicated DB flag — approximated as "a split has been
// generated" since a user can't split without having looked at the items
// tab first. Documented heuristic, not a real tracked state.
function deriveBadge(tab: TabState | undefined): BadgeStatus {
  if (!tab || tab.status === "loading") return "Processing";
  if (tab.status === "error") return "Error";
  const d = tab.data!;
  if (d.outgoing.length === 0) return "Ready";
  const steps = computeWorkflowSteps(d.outgoingStats, d.buyerLog);
  if (isWorkflowComplete(steps)) return "Completed";
  if (d.outgoingStats.sent > 0) return "Sent";
  return "Reviewed";
}

const badgeStyle: Record<BadgeStatus, string> = {
  Processing: "bg-blue-50 text-blue-700 border-blue-200",
  Ready:      "bg-gray-100 text-gray-600 border-gray-200",
  Reviewed:   "bg-amber-50 text-amber-700 border-amber-200",
  Sent:       "bg-indigo-50 text-indigo-700 border-indigo-200",
  Completed:  "bg-green-50 text-green-700 border-green-200",
  Error:      "bg-red-50 text-red-700 border-red-200",
};

function WorkspaceInner() {
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tabs, setTabs]   = useState<Record<string, TabState>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const initialized = useRef(false);

  // Merge ?ids= from this navigation with whatever was already open
  // (sessionStorage) so processing more RFQs while a workspace is open
  // adds to it instead of replacing it.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const fromQuery = (searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    let fromStorage: string[] = [];
    try { fromStorage = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { /* ignore */ }

    const merged = [...fromStorage];
    for (const id of fromQuery) if (!merged.includes(id)) merged.push(id);

    setOpenIds(merged);
    setActiveId(fromQuery[0] ?? merged[0] ?? null);
  }, [searchParams]);

  useEffect(() => {
    if (!initialized.current) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(openIds));
  }, [openIds]);

  // Fetch full detail for any open tab we don't have data for yet.
  async function loadTab(id: string) {
    setTabs((prev) => ({ ...prev, [id]: { status: "loading" } }));
    try {
      const data = await fetchRfqDetail(supabase, id);
      setTabs((prev) => ({ ...prev, [id]: { status: "ready", data } }));
    } catch (err) {
      setTabs((prev) => ({ ...prev, [id]: { status: "error", error: err instanceof Error ? err.message : "Failed to load" } }));
    }
  }

  useEffect(() => {
    for (const id of openIds) if (!tabs[id]) loadTab(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIds]);

  function closeTab(id: string) {
    if (dirty[id] && !confirm("This RFQ has unsent message edits. Close anyway? Your edits will be lost.")) {
      return;
    }
    const idx = openIds.indexOf(id);
    const next = openIds.filter((x) => x !== id);
    setOpenIds(next);
    if (activeId === id) setActiveId(next[idx] ?? next[idx - 1] ?? next[0] ?? null);
    setTabs((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setDirty((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  function step(delta: 1 | -1) {
    if (!activeId || openIds.length < 2) return;
    const idx = openIds.indexOf(activeId);
    setActiveId(openIds[(idx + delta + openIds.length) % openIds.length]);
  }

  if (openIds.length === 0) {
    return (
      <>
        <DashboardHeader title="RFQ Workspace" />
        <main className="flex-1 p-8 flex flex-col items-center justify-center text-center">
          <p className="text-gray-400 font-medium">No RFQs open</p>
          <p className="text-gray-400 text-sm mt-1 mb-4">Select RFQs from the inbox and click &ldquo;Process Selected&rdquo; to open them here.</p>
          <Link href="/inbox" className="text-blue-600 text-sm font-medium hover:underline">Go to Inbox →</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <DashboardHeader title="RFQ Workspace" />

      {/* Tab strip */}
      <div className="border-b border-gray-100 bg-white sticky top-0 z-20 flex items-center px-2">
        <button onClick={() => step(-1)} disabled={openIds.length < 2} title="Previous RFQ"
          className="p-2 text-gray-400 hover:text-gray-700 disabled:opacity-30 flex-shrink-0">
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 flex items-center gap-1 overflow-x-auto py-2 px-1">
          {openIds.map((id) => {
            const tab = tabs[id];
            const badge = deriveBadge(tab);
            const label = tab?.data ? tab.data.rfq.rfq_code : "Loading…";
            const sub = tab?.data?.rfq.buyer_name;
            return (
              <button
                key={id}
                onClick={() => setActiveId(id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors flex-shrink-0 border",
                  activeId === id ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" : "border-transparent text-gray-500 hover:bg-gray-50"
                )}
              >
                {tab?.status === "loading" && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
                {tab?.status === "error" && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                <span>{label}{sub ? ` · ${sub}` : ""}</span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium flex-shrink-0", badgeStyle[badge])}>{badge}</span>
                {dirty[id] && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Unsaved changes" />}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); closeTab(id); }}
                  className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                  title="Close tab"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              </button>
            );
          })}
        </div>

        <button onClick={() => step(1)} disabled={openIds.length < 2} title="Next RFQ"
          className="p-2 text-gray-400 hover:text-gray-700 disabled:opacity-30 flex-shrink-0">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Every open tab stays mounted (just hidden) so switching tabs never
          loses local state — unlike route navigation, which would remount
          RfqDetailClient from scratch and discard unsent message edits. */}
      {openIds.map((id) => {
        const tab = tabs[id];
        return (
          <div key={id} className={activeId === id ? "block" : "hidden"}>
            {!tab || tab.status === "loading" ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : tab.status === "error" ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <AlertTriangle className="w-8 h-8 text-red-300 mb-3" />
                <p className="text-gray-500 font-medium">Couldn&apos;t load this RFQ</p>
                <p className="text-gray-400 text-sm mt-1">{tab.error}</p>
              </div>
            ) : (
              <RfqDetailClient
                rfq={tab.data!.rfq}
                items={tab.data!.items}
                outgoing={tab.data!.outgoing}
                outgoingItems={tab.data!.outgoingItems}
                outgoingStats={tab.data!.outgoingStats}
                buyerLog={tab.data!.buyerLog}
                itemImages={tab.data!.itemImages}
                onDirtyChange={(d) => setDirty((prev) => ({ ...prev, [id]: d }))}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export default function RfqWorkspacePage() {
  return (
    <Suspense fallback={
      <>
        <DashboardHeader title="RFQ Workspace" />
        <main className="flex-1 flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </main>
      </>
    }>
      <WorkspaceInner />
    </Suspense>
  );
}
