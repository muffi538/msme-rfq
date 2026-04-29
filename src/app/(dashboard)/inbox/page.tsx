"use client";

import { useState, useEffect, useRef } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import {
  Mail, Loader2, CheckCircle, AlertCircle, Sparkles,
  ArrowRight, Clock, Send, Tag, X, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* ── Types ─────────────────────────────────────────────── */
type FetchResult = { rfqCode: string; subject: string; from: string; hasAttachment: boolean };
type PendingRfq  = { id: string; rfq_code: string; buyer_name: string | null; buyer_email: string | null; file_name: string | null; created_at: string };
type DoneRfq     = { id: string; rfq_code: string; buyer_name: string | null; status: string; created_at: string };
type RfqLabel    = "important" | "waiting_reply" | "in_progress" | "spam";
type FilterTab   = "all" | RfqLabel;

/* ── Label config ───────────────────────────────────────── */
const LABELS: { value: RfqLabel; emoji: string; label: string; pill: string }[] = [
  { value: "important",     emoji: "🔴", label: "Important",     pill: "bg-red-50 text-red-700 border border-red-200" },
  { value: "waiting_reply", emoji: "⏳", label: "Waiting Reply",  pill: "bg-amber-50 text-amber-700 border border-amber-200" },
  { value: "in_progress",   emoji: "🔵", label: "In Progress",   pill: "bg-blue-50 text-blue-700 border border-blue-200" },
  { value: "spam",          emoji: "🚫", label: "Spam",          pill: "bg-gray-100 text-gray-500 border border-gray-200" },
];

function fmt(iso: string) {
  if (!iso) return "Unknown time";
  const d   = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown time";
  const now  = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(diff / 3_600_000);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hrs  < 24)  return `${hrs}h ago · ${time}`;

  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay    = new Date(d); msgDay.setHours(0,0,0,0);

  if (msgDay.getTime() === yesterday.getTime()) return `Yesterday · ${time}`;

  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago · ${time}`;

  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${time}`;
}

/* ── Label pill ─────────────────────────────────────────── */
function LabelPill({ value }: { value: RfqLabel }) {
  const cfg = LABELS.find((l) => l.value === value);
  if (!cfg) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium", cfg.pill)}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

/* ── Label selector dropdown ────────────────────────────── */
function LabelSelector({
  rfqId, current, onSet,
}: {
  rfqId: string;
  current: RfqLabel | undefined;
  onSet: (id: string, label: RfqLabel | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className={cn(
          "flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors",
          current
            ? "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            : "bg-white border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600"
        )}
      >
        <Tag className="w-3 h-3" />
        {current ? LABELS.find((l) => l.value === current)?.label : "Label"}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 w-44">
          {LABELS.map((lbl) => (
            <button
              key={lbl.value}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSet(rfqId, lbl.value); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                current === lbl.value ? "bg-gray-50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-50"
              )}
            >
              <span className="text-base">{lbl.emoji}</span>
              {lbl.label}
              {current === lbl.value && <CheckCircle className="w-3.5 h-3.5 ml-auto text-blue-500" />}
            </button>
          ))}
          {current && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSet(rfqId, null); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-50 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Remove label
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────── */
export default function InboxPage() {
  const [fetching,     setFetching]     = useState(false);
  const [fetchResults, setFetchResults] = useState<FetchResult[] | null>(null);
  const [fetchError,   setFetchError]   = useState("");
  const [pending,      setPending]      = useState<PendingRfq[]>([]);
  const [done,         setDone]         = useState<DoneRfq[]>([]);
  const [processing,   setProcessing]   = useState<Record<string, boolean>>({});
  const [justDone,     setJustDone]     = useState<Record<string, boolean>>({});
  const [labels,       setLabels]       = useState<Record<string, RfqLabel>>({});
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  useEffect(() => { loadAll(); loadLabels(); }, []);

  /* ── Data loading ─────────────────────────────────────── */
  async function loadAll() { await Promise.all([loadPending(), loadDone()]); }

  async function loadPending() {
    const res  = await fetch("/api/rfqs/pending");
    if (!res.ok) return;
    const data = await res.json();
    // Newest first — guard against null/invalid timestamps
    const ts = (r: PendingRfq) => (r.created_at ? new Date(r.created_at).getTime() : 0) || 0;
    const sorted = [...(data.rfqs ?? [])].sort((a, b) => ts(b) - ts(a));
    setPending(sorted);
  }

  async function loadDone() {
    const supabase = createClient();
    const { data } = await supabase
      .from("rfqs")
      .select("id, rfq_code, buyer_name, status, created_at")
      .in("status", ["processed", "approved", "sent"])
      .like("file_name", "msgid:%")
      .order("created_at", { ascending: false })
      .limit(30);
    setDone(data ?? []);
  }

  async function loadLabels() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "rfq_labels")
      .single();
    if (data?.value) {
      try { setLabels(JSON.parse(data.value)); } catch { /* ignore */ }
    }
  }

  /* ── Label save ───────────────────────────────────────── */
  async function setLabel(rfqId: string, label: RfqLabel | null) {
    const next = { ...labels };
    if (label === null) delete next[rfqId];
    else next[rfqId] = label;
    setLabels(next);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("user_settings").upsert(
      { user_id: user.id, key: "rfq_labels", value: JSON.stringify(next) },
      { onConflict: "user_id,key" }
    );
  }

  /* ── Fetch emails ─────────────────────────────────────── */
  async function handleFetch() {
    setFetching(true);
    setFetchError("");
    setFetchResults(null);
    try {
      const res  = await fetch("/api/email/fetch", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fetch failed");
      setFetchResults(json.results ?? []);
      if (json.created === 0) toast.info("No new emails found.");
      else toast.success(`${json.created} new email${json.created > 1 ? "s" : ""} fetched!`);
      await loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setFetching(false);
    }
  }

  /* ── Run AI ───────────────────────────────────────────── */
  async function handleProcess(rfqId: string) {
    setProcessing((p) => ({ ...p, [rfqId]: true }));
    try {
      const res  = await fetch(`/api/rfqs/${rfqId}/process`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Processing failed");

      setJustDone((p) => ({ ...p, [rfqId]: true }));
      setProcessing((p) => ({ ...p, [rfqId]: false }));
      const moved = pending.find((r) => r.id === rfqId);
      setPending((p) => p.filter((r) => r.id !== rfqId));
      if (moved) {
        setDone((prev) => [{
          id: moved.id, rfq_code: moved.rfq_code,
          buyer_name: moved.buyer_name, status: "processed",
          created_at: moved.created_at,
        }, ...prev]);
      }
      toast.success(`${json.itemCount} items extracted! Opening in new tab…`);
      setTimeout(() => window.open(`/rfqs/${rfqId}`, "_blank"), 800);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
      setProcessing((p) => ({ ...p, [rfqId]: false }));
    }
  }

  /* ── Derived stats ────────────────────────────────────── */
  const stats = {
    needAI:    pending.length,
    aiDone:    done.filter((r) => r.status === "processed").length,
    approved:  done.filter((r) => r.status === "approved").length,
    sent:      done.filter((r) => r.status === "sent").length,
    important: Object.values(labels).filter((l) => l === "important").length,
    spam:      Object.values(labels).filter((l) => l === "spam").length,
  };

  /* ── Label filter counts ──────────────────────────────── */
  const allItems = [...pending.map((r) => r.id), ...done.map((r) => r.id)];
  const filterCounts: Record<FilterTab, number> = {
    all:           allItems.length,
    important:     allItems.filter((id) => labels[id] === "important").length,
    waiting_reply: allItems.filter((id) => labels[id] === "waiting_reply").length,
    in_progress:   allItems.filter((id) => labels[id] === "in_progress").length,
    spam:          allItems.filter((id) => labels[id] === "spam").length,
  };

  /* ── Filtered lists ───────────────────────────────────── */
  const filteredPending = activeFilter === "all"
    ? pending
    : pending.filter((r) => labels[r.id] === activeFilter);

  const filteredDone = activeFilter === "all"
    ? done
    : done.filter((r) => labels[r.id] === activeFilter);

  const statusLabel: Record<string, string> = {
    processed: "AI done",
    approved:  "Approved",
    sent:      "Sent",
  };

  return (
    <>
      <DashboardHeader title="Email Inbox" />
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">

        {/* ── Stats row ── */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: "Need AI Run",  value: stats.needAI,   icon: Sparkles,    bg: "bg-orange-50",  text: "text-orange-600",  border: "border-orange-100" },
            { label: "AI Done",      value: stats.aiDone,   icon: CheckCircle, bg: "bg-green-50",   text: "text-green-600",   border: "border-green-100"  },
            { label: "Approved",     value: stats.approved, icon: ArrowRight,  bg: "bg-indigo-50",  text: "text-indigo-600",  border: "border-indigo-100" },
            { label: "Sent",         value: stats.sent,     icon: Send,        bg: "bg-gray-50",    text: "text-gray-600",    border: "border-gray-200"   },
            { label: "Important",    value: stats.important,icon: Tag,         bg: "bg-red-50",     text: "text-red-600",     border: "border-red-100"    },
            { label: "Spam",         value: stats.spam,     icon: Mail,        bg: "bg-gray-50",    text: "text-gray-400",    border: "border-gray-200"   },
          ].map((s) => (
            <div key={s.label} className={cn("rounded-xl border p-3 flex flex-col gap-1", s.bg, s.border)}>
              <s.icon className={cn("w-4 h-4", s.text)} />
              <p className={cn("text-xl font-black leading-none", s.text)}>{s.value}</p>
              <p className="text-[11px] text-gray-500 font-medium leading-tight">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Fetch card ── */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-card-foreground">Gmail RFQ Importer</h2>
              <p className="text-muted-foreground text-xs mt-0.5">
                Connected to <span className="font-medium text-foreground">mufaddal66you@gmail.com</span>
                {" · "}Step 1: Fetch · Step 2: Run AI → review → send
              </p>
            </div>
          </div>

          <Button onClick={handleFetch} disabled={fetching}
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2">
            {fetching
              ? <><Loader2 className="w-4 h-4 animate-spin" />Connecting to Gmail…</>
              : <><Mail className="w-4 h-4" />Fetch New Emails</>}
          </Button>

          {fetchError && (
            <div className="flex items-start gap-3 bg-red-50 text-red-700 rounded-xl px-4 py-3 mt-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Fetch failed</p>
                <p className="text-red-500 text-xs mt-0.5">{fetchError}</p>
              </div>
            </div>
          )}

          {fetchResults !== null && !fetchError && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl px-4 py-2.5 mt-3">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              {fetchResults.length === 0
                ? "Inbox is up to date — no new emails."
                : `${fetchResults.length} new email${fetchResults.length > 1 ? "s" : ""} fetched. Run AI below.`}
            </div>
          )}
        </div>

        {/* ── Filter tabs ── */}
        {allItems.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {([
              { key: "all",           label: "All" },
              { key: "important",     label: "🔴 Important" },
              { key: "waiting_reply", label: "⏳ Waiting Reply" },
              { key: "in_progress",   label: "🔵 In Progress" },
              { key: "spam",          label: "🚫 Spam" },
            ] as { key: FilterTab; label: string }[]).map(({ key, label }) => {
              const count = filterCounts[key];
              if (key !== "all" && count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all border",
                    activeFilter === key
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-card text-muted-foreground border-border hover:border-gray-400 hover:text-foreground"
                  )}
                >
                  {label}
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full font-semibold",
                    activeFilter === key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Pending — AI not yet run ── */}
        {filteredPending.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-500" />
                <span className="font-semibold text-card-foreground text-sm">
                  Need AI Processing
                  <span className="ml-1.5 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">
                    {filteredPending.length}
                  </span>
                </span>
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">Newest first</span>
            </div>

            <div className="divide-y divide-border">
              {filteredPending.map((rfq) => (
                <div
                  key={rfq.id}
                  className={cn(
                    "flex items-center gap-3 px-5 py-4 transition-colors",
                    justDone[rfq.id] ? "bg-green-50 dark:bg-green-950/20" : "hover:bg-muted/40",
                    labels[rfq.id] === "spam" && "opacity-60"
                  )}
                >
                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-card-foreground text-sm">{rfq.rfq_code}</p>
                      {labels[rfq.id] && <LabelPill value={labels[rfq.id]} />}
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {rfq.buyer_name ?? rfq.buyer_email ?? "Unknown sender"}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {fmt(rfq.created_at)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <LabelSelector rfqId={rfq.id} current={labels[rfq.id]} onSet={setLabel} />

                    {justDone[rfq.id] ? (
                      <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
                        <CheckCircle className="w-4 h-4" /> Done
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleProcess(rfq.id)}
                        disabled={processing[rfq.id] || labels[rfq.id] === "spam"}
                        className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-8 text-xs"
                      >
                        {processing[rfq.id]
                          ? <><Loader2 className="w-3 h-3 animate-spin" />Processing…</>
                          : <><Sparkles className="w-3 h-3" />Run AI<ArrowRight className="w-3 h-3" /></>}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Done — AI already ran ── */}
        {filteredDone.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="font-semibold text-card-foreground text-sm">
                  Processed
                  <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">
                    {filteredDone.length}
                  </span>
                </span>
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">AI has run on these</span>
            </div>

            <div className="divide-y divide-border">
              {filteredDone.map((rfq) => (
                <div key={rfq.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors group">
                  {/* Clickable area */}
                  <Link
                    href={`/rfqs/${rfq.id}`}
                    target="_blank"
                    className="flex items-center gap-3 min-w-0 flex-1"
                  >
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-card-foreground text-sm group-hover:text-blue-600 transition-colors">{rfq.rfq_code}</p>
                        {labels[rfq.id] && <LabelPill value={labels[rfq.id]} />}
                        <span className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full font-medium",
                          rfq.status === "sent"     ? "bg-gray-100 text-gray-600" :
                          rfq.status === "approved" ? "bg-indigo-100 text-indigo-700" :
                                                      "bg-green-100 text-green-700"
                        )}>
                          {statusLabel[rfq.status] ?? rfq.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {fmt(rfq.created_at)}
                        {rfq.buyer_name && <span className="ml-1">· {rfq.buyer_name}</span>}
                      </p>
                    </div>
                  </Link>

                  {/* Label selector */}
                  <LabelSelector rfqId={rfq.id} current={labels[rfq.id]} onSet={setLabel} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state for filtered view */}
        {activeFilter !== "all" && filteredPending.length === 0 && filteredDone.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Tag className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No emails labelled &quot;{LABELS.find((l) => l.value === activeFilter)?.label}&quot;</p>
            <p className="text-sm mt-1 opacity-70">Use the label button on any email to tag it</p>
          </div>
        )}

        {/* Empty state — no emails at all */}
        {pending.length === 0 && done.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No emails yet</p>
            <p className="text-sm mt-1 opacity-70">Click &quot;Fetch New Emails&quot; to pull your Gmail inbox</p>
          </div>
        )}

      </main>
    </>
  );
}
