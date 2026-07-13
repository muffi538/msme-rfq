"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import {
  Mail, Loader2, CheckCircle, AlertCircle, Sparkles,
  ArrowRight, Clock, Send, Tag, X, ChevronDown, Trash2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { pollJob } from "@/lib/pollJob";

/* ── Types ─────────────────────────────────────────────── */
type FetchResult = { rfqCode: string; subject: string; from: string; hasAttachment: boolean };
type PendingRfq  = { id: string; rfq_code: string; buyer_name: string | null; buyer_email: string | null; file_name: string | null; created_at: string };
type DoneRfq     = { id: string; rfq_code: string; buyer_name: string | null; status: string; created_at: string };

function processStageLabel(p: { stage: string; processed: number; total: number } | null | undefined): string {
  if (!p) return "Processing…";
  if (p.stage === "found")    return `Found ${p.total} attachment${p.total === 1 ? "" : "s"}…`;
  if (p.stage === "matching") return "Matching images…";
  if (p.stage === "complete") return "Done";
  if (p.processed >= p.total) return "Merging items…";
  return `Attachment ${p.processed + 1} of ${p.total}…`;
}
type RfqLabel    = "important" | "waiting_reply" | "in_progress" | "spam";
type FilterTab   = "all" | RfqLabel;
type ViewMode    = "all" | "new" | "process" | "done";

/* ── Label config ───────────────────────────────────────── */
const LABELS: { value: RfqLabel; emoji: string; label: string; pill: string }[] = [
  { value: "important",     emoji: "🔴", label: "Important",     pill: "bg-red-50 text-red-700 border border-red-200" },
  { value: "waiting_reply", emoji: "⏳", label: "Waiting Reply",  pill: "bg-amber-50 text-amber-700 border border-amber-200" },
  { value: "in_progress",   emoji: "🔵", label: "In Progress",   pill: "bg-[#1847F5]/8 text-[#1847F5] border border-[#1847F5]/20" },
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
              {current === lbl.value && <CheckCircle className="w-3.5 h-3.5 ml-auto text-[#1847F5]" />}
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
  const router = useRouter();
  const [fetching,     setFetching]     = useState(false);
  const [fetchProgress, setFetchProgress] = useState<{ processed: number; total: number } | null>(null);
  const [creatingSample, setCreatingSample] = useState(false);
  const [fetchResults, setFetchResults] = useState<FetchResult[] | null>(null);
  const [fetchError,   setFetchError]   = useState("");
  const [pending,      setPending]      = useState<PendingRfq[]>([]);
  const [done,         setDone]         = useState<DoneRfq[]>([]);
  const [processing,   setProcessing]   = useState<Record<string, boolean>>({});
  const [processProgress, setProcessProgress] = useState<Record<string, { stage: string; processed: number; total: number } | null>>({});
  const [justDone,     setJustDone]     = useState<Record<string, boolean>>({});
  const [labels,       setLabels]       = useState<Record<string, RfqLabel>>({});
  const [deleteTarget, setDeleteTarget] = useState<PendingRfq | null>(null);
  const [deletingEmail, setDeletingEmail] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchRunning,  setBatchRunning]  = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ processed: number; total: number } | null>(null);
  const batchCancelRef = useRef(false);
  const [bulkDeleteOpen,  setBulkDeleteOpen]  = useState(false);
  const [bulkDeleting,    setBulkDeleting]    = useState(false);
  const [bulkLabelOpen,   setBulkLabelOpen]   = useState(false);
  const bulkLabelMenuRef = useRef<HTMLDivElement>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bulkLabelOpen) return;
    function handle(e: MouseEvent) {
      if (bulkLabelMenuRef.current && !bulkLabelMenuRef.current.contains(e.target as Node)) setBulkLabelOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [bulkLabelOpen]);
  // ── Persist filter + view-mode in sessionStorage so navigating away and
  // coming back keeps the user on the tab they left on (no jarring reset).
  const [activeFilter, setActiveFilter] = useState<FilterTab>(() => {
    if (typeof window === "undefined") return "all";
    return (sessionStorage.getItem("inbox.activeFilter") as FilterTab) || "all";
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "all";
    return (sessionStorage.getItem("inbox.viewMode") as ViewMode) || "all";
  });

  useEffect(() => { sessionStorage.setItem("inbox.activeFilter", activeFilter); }, [activeFilter]);
  useEffect(() => { sessionStorage.setItem("inbox.viewMode",     viewMode);     }, [viewMode]);

  const [gmailEmail,   setGmailEmail]   = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState(true);

  useEffect(() => { loadAll(); loadLabels(); loadGmailStatus(); }, []);

  /* ── Surface the result of the Gmail OAuth redirect ────── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("gmail_connected");
    const error = params.get("gmail_error");
    const detail = params.get("detail");
    if (!connected && !error) return;

    if (detail) console.error("[gmail-oauth]", error ?? "connected", "-", detail);

    const withDetail = (msg: string) => detail ? `${msg} (${detail})` : msg;

    if (connected) {
      toast.success("Gmail connected!");
      loadGmailStatus();
    }
    else if (error === "not_configured") {
      toast.error("Gmail login isn't set up yet. Ask your admin to configure GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.");
    } else if (error === "access_denied") {
      toast.error(withDetail("Gmail connection was cancelled."));
    } else if (error === "token_failed") {
      toast.error(withDetail("Couldn't finish connecting to Gmail. Please try again."), { duration: 15000 });
    } else if (error === "profile_failed") {
      toast.error(withDetail("Couldn't read your Gmail address from Google. Please try connecting again."), { duration: 15000 });
    } else if (error === "save_failed") {
      toast.error(withDetail("Connected to Gmail, but couldn't save it to your account. Please try again."), { duration: 15000 });
    } else {
      toast.error(withDetail("Something went wrong connecting Gmail."), { duration: 15000 });
    }

    params.delete("gmail_connected");
    params.delete("gmail_error");
    params.delete("detail");
    const query = params.toString();
    router.replace(query ? `/inbox?${query}` : "/inbox");
  }, [router]);

  /* ── Gmail status ────────────────────────────────────── */
  async function loadGmailStatus() {
    setGmailLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setGmailLoading(false); return; }
    // .limit(1) instead of .single() — .single() throws (and yields no data)
    // if more than one row ever matched this user_id+key, which would
    // silently look like "not connected" even after a successful save.
    const { data, error } = await supabase
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "gmail_email")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) console.error("[gmail-status] lookup failed", error);
    setGmailEmail(data?.[0]?.value || null);
    setGmailLoading(false);
  }

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
    // Defensive: re-sort client-side too — newest first
    const ts = (r: DoneRfq) => (r.created_at ? new Date(r.created_at).getTime() : 0) || 0;
    const sorted = [...(data ?? [])].sort((a, b) => ts(b) - ts(a));
    setDone(sorted);
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
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: user.id, key: "rfq_labels", value: JSON.stringify(next) },
      { onConflict: "user_id,key" }
    );
    if (error) {
      console.error("[inbox] label save failed", error);
      toast.error(`Couldn't save label: ${error.message}`);
      setLabels(labels); // revert the optimistic update
    }
  }

  // Bulk label — applies to every selected RFQ in ONE write (labels are
  // stored as a single JSON blob), instead of one upsert per RFQ.
  async function bulkSetLabel(ids: string[], label: RfqLabel | null) {
    const next = { ...labels };
    for (const id of ids) {
      if (label === null) delete next[id];
      else next[id] = label;
    }
    setLabels(next);
    setBulkLabelOpen(false);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: user.id, key: "rfq_labels", value: JSON.stringify(next) },
      { onConflict: "user_id,key" }
    );
    if (error) {
      console.error("[inbox] bulk label save failed", error);
      toast.error(`Couldn't save label: ${error.message}`);
      setLabels(labels);
      return;
    }
    toast.success(`Labelled ${ids.length} RFQ${ids.length > 1 ? "s" : ""}.`);
    setBatchSelected(new Set());
  }

  /* ── Fetch emails ─────────────────────────────────────────
     Kicks off a background job and polls for completion instead of
     holding the request open — the button click returns almost
     instantly and the rest of the app stays fully usable while Gmail
     is being scanned. ──────────────────────────────────────── */
  async function handleFetch() {
    setFetching(true);
    setFetchError("");
    setFetchResults(null);
    setFetchProgress(null);
    try {
      const res  = await fetch("/api/email/fetch", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fetch failed");

      const result = await pollJob<
        { processed: number; total: number },
        { results?: FetchResult[]; created: number; fetched: number; deduped: number; insertFailed: number; lastInsertError?: string }
      >(json.jobId, setFetchProgress);

      setFetchResults(result.results ?? []);
      if (result.created > 0) {
        toast.success(`${result.created} new email${result.created > 1 ? "s" : ""} fetched!`);
      } else if (result.insertFailed > 0) {
        toast.error(`Found ${result.fetched} unread email(s) but couldn't save ${result.insertFailed} of them: ${result.lastInsertError ?? "unknown error"}`, { duration: 15000 });
      } else if (result.deduped > 0) {
        toast.info(`Found ${result.fetched} unread email(s), but they were already imported previously.`);
      } else {
        toast.info("No new emails found.");
      }
      await loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setFetching(false);
      setFetchProgress(null);
    }
  }

  /* ── Try a sample RFQ (first-run helper) ─────────────── */
  async function handleSampleRfq() {
    setCreatingSample(true);
    try {
      const res  = await fetch("/api/rfqs/sample", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create sample");
      toast.success(`Sample RFQ created — click "Process it" to try it out.`);
      await loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setCreatingSample(false);
    }
  }

  /* ── Run AI — processes every attachment on the email, not just the
     first one, and merges them into one RFQ. Job-based so the button can
     show real "attachment i of N" progress instead of a blind spinner. ── */
  // Core of "process one RFQ" — kicks off the job, polls it, and moves the
  // row from pending → done in local state. Shared by the single "Process
  // it" button and batch processing; toasting/navigation is left to each
  // caller since they want different messaging.
  async function processOneRfq(rfqId: string): Promise<
    { ok: true; result: { itemCount: number; foundCount: number; processedCount: number; failedFiles: string[]; warnings: string[] } }
    | { ok: false; error: string }
  > {
    setProcessing((p) => ({ ...p, [rfqId]: true }));
    setProcessProgress((p) => ({ ...p, [rfqId]: null }));
    try {
      const res  = await fetch(`/api/rfqs/${rfqId}/process`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Processing failed");

      const result = await pollJob<
        { stage: string; processed: number; total: number; currentFile?: string },
        { itemCount: number; foundCount: number; processedCount: number; failedFiles: string[]; warnings: string[] }
      >(json.jobId, (p) => setProcessProgress((prev) => ({ ...prev, [rfqId]: p })));

      setJustDone((p) => ({ ...p, [rfqId]: true }));
      const moved = pending.find((r) => r.id === rfqId);
      setPending((p) => p.filter((r) => r.id !== rfqId));
      if (moved) {
        setDone((prev) => [{
          id: moved.id, rfq_code: moved.rfq_code,
          buyer_name: moved.buyer_name, status: "processed",
          created_at: moved.created_at,
        }, ...prev]);
      }
      return { ok: true, result };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : "Processing failed" };
    } finally {
      setProcessing((p) => ({ ...p, [rfqId]: false }));
    }
  }

  async function handleProcess(rfqId: string) {
    const outcome = await processOneRfq(rfqId);
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    const { result } = outcome;
    if (result.failedFiles.length > 0) {
      toast.warning(`${result.failedFiles.length} attachment(s) couldn't be read: ${result.failedFiles.join(", ")}`, { duration: 10000 });
    }
    toast.success(
      `Files Processed: ${result.processedCount}/${result.foundCount} — Items Extracted: ${result.itemCount} — Failed Files: ${result.failedFiles.length}. Opening RFQ…`
    );
    setTimeout(() => router.push(`/rfqs/${rfqId}`), 800);
  }

  /* ── Batch processing — sequential (each RFQ still calls the same
     background job as a single "Process it"; running them in parallel
     would just contend for the same OpenAI rate limit budget with worse
     progress reporting). Continues past individual failures, reports a
     summary, and can be cancelled between items. ── */
  async function handleBatchProcess() {
    const ids = [...batchSelected];
    if (ids.length === 0) return;
    setBatchRunning(true);
    batchCancelRef.current = false;
    setBatchProgress({ processed: 0, total: ids.length });

    const succeeded: string[] = [];
    const failed: { id: string; rfqCode: string; error: string }[] = [];

    for (let i = 0; i < ids.length; i++) {
      if (batchCancelRef.current) break;
      const rfqId = ids[i];
      const rfqCode = pending.find((r) => r.id === rfqId)?.rfq_code ?? rfqId;
      setBatchProgress({ processed: i, total: ids.length });

      const outcome = await processOneRfq(rfqId);
      if (outcome.ok) succeeded.push(rfqId);
      else failed.push({ id: rfqId, rfqCode, error: outcome.error });
      setBatchProgress({ processed: i + 1, total: ids.length });
    }

    setBatchRunning(false);
    setBatchSelected(new Set());

    const cancelled = batchCancelRef.current;
    if (failed.length > 0) {
      toast.warning(
        `${failed.length} RFQ(s) failed to process: ${failed.map((f) => f.rfqCode).join(", ")}. ${succeeded.length} succeeded.`,
        { duration: 12000 }
      );
    }
    if (succeeded.length === 0) {
      if (!cancelled) toast.error("None of the selected RFQs could be processed.");
      return;
    }

    toast.success(
      `${cancelled ? "Cancelled — " : ""}Completed ${succeeded.length} of ${ids.length}. Opening workspace…`
    );
    setTimeout(() => router.push(`/rfqs/workspace?ids=${succeeded.join(",")}`), 600);
  }

  function cancelBatch() {
    batchCancelRef.current = true;
    toast.info("Cancelling after the current RFQ finishes…");
  }

  /* ── Remove from dashboard — this is a local hide, never a Gmail action.
     The RFQ row stays in the database (hidden_from_dashboard=true) so the
     same email is never re-imported on a future sync; it just stops
     showing up here. Gmail itself is never touched. ── */
  async function confirmDeleteEmail() {
    if (!deleteTarget) return;
    const rfq = deleteTarget;
    setDeletingEmail(true);
    try {
      const res  = await fetch(`/api/rfqs/${rfq.id}/hide`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not remove this RFQ");

      setPending((p) => p.filter((r) => r.id !== rfq.id));
      setDeleteTarget(null);

      toast.success("Removed from dashboard — the original email is untouched in Gmail.", {
        duration: 10000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              const undoRes = await fetch(`/api/rfqs/${rfq.id}/unhide`, { method: "POST" });
              if (!undoRes.ok) throw new Error();
              const ts = (r: PendingRfq) => (r.created_at ? new Date(r.created_at).getTime() : 0) || 0;
              setPending((prev) => [...prev, rfq].sort((a, b) => ts(b) - ts(a)));
              toast.success("Restored to dashboard.");
            } catch {
              toast.error("Couldn't undo — restore it from Settings → Restore Hidden Emails instead.");
            }
          },
        },
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not remove this RFQ");
    } finally {
      setDeletingEmail(false);
    }
  }

  /* ── Bulk delete — same dashboard-only hide as the single delete above,
     just as one batch request instead of N. Undo isn't offered here (a
     10-item undo would need its own multi-step UI); Settings → Restore
     Hidden Emails always covers it. ── */
  async function confirmBulkDelete() {
    const ids = [...batchSelected];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const res  = await fetch("/api/rfqs/bulk-hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Bulk delete failed");

      const succeeded: string[] = json.succeeded ?? [];
      const failed: string[] = json.failed ?? [];
      const succeededSet = new Set(succeeded);
      setPending((p) => p.filter((r) => !succeededSet.has(r.id)));
      setBatchSelected(new Set());
      setBulkDeleteOpen(false);

      if (failed.length > 0) {
        toast.warning(`${succeeded.length} deleted, ${failed.length} failed.`, { duration: 10000 });
      } else {
        toast.success(`${succeeded.length} RFQ${succeeded.length > 1 ? "s" : ""} removed from dashboard — original emails are untouched in Gmail.`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBulkDeleting(false);
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
  // Split pending into "new mail" (last 24h) vs "process it" (older backlog)
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const newMail   = pending.filter((r) => r.created_at && new Date(r.created_at).getTime() >= cutoff);
  const processIt = pending.filter((r) => !(r.created_at && new Date(r.created_at).getTime() >= cutoff));

  const filteredPending = activeFilter === "all"
    ? pending
    : pending.filter((r) => labels[r.id] === activeFilter);

  const filteredDone = activeFilter === "all"
    ? done
    : done.filter((r) => labels[r.id] === activeFilter);

  // What pending items show, given the view mode
  const pendingForView =
    viewMode === "new"     ? newMail
    : viewMode === "process" ? processIt
    : filteredPending;

  // Label-filter on top of view-mode
  const visiblePending = activeFilter === "all"
    ? pendingForView
    : pendingForView.filter((r) => labels[r.id] === activeFilter);

  const statusLabel: Record<string, string> = {
    processed: "AI done",
    approved:  "Approved",
    sent:      "Sent",
  };

  return (
    <>
      {/* Remove-from-dashboard confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-950/40 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-card-foreground">Remove this RFQ from your dashboard?</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  This will only remove <strong>{deleteTarget.rfq_code}</strong> from ProcureAI. The original email will remain safely in your Gmail inbox.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={confirmDeleteEmail}
                disabled={deletingEmail}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {deletingEmail ? "Removing..." : "Remove from Dashboard"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingEmail}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      <DashboardHeader title="Email Inbox" />
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">

        {/* ── Chapter label ── */}
        <div>
          <div className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase mb-3">
            <div className="h-px w-8 bg-border" />
            <span>Inbox Overview</span>
          </div>
          <div className="h-px bg-border" />
        </div>

        {/* ── Stats row — gap-px grid ── */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-border border border-border rounded-2xl overflow-hidden">
          {[
            { label: "Need AI Run",  value: stats.needAI,    icon: Sparkles,    text: "text-orange-500" },
            { label: "AI Done",      value: stats.aiDone,    icon: CheckCircle, text: "text-green-500"  },
            { label: "Approved",     value: stats.approved,  icon: ArrowRight,  text: "text-[#1847F5]"  },
            { label: "Sent",         value: stats.sent,      icon: Send,        text: "text-muted-foreground" },
            { label: "Important",    value: stats.important, icon: Tag,         text: "text-red-500"    },
            { label: "Spam",         value: stats.spam,      icon: Mail,        text: "text-muted-foreground/50" },
          ].map((s) => (
            <div key={s.label} className="bg-card p-4 flex flex-col gap-2">
              <s.icon className={cn("w-3.5 h-3.5", s.text)} />
              <p className={cn("text-2xl font-black leading-none", s.text)}
                style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>
                {s.value}
              </p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest leading-tight">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Gmail connection card ── */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-10 h-10 bg-[#1847F5]/8 rounded-xl flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-[#1847F5]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-card-foreground">Gmail RFQ Importer</h2>
              <p className="text-muted-foreground text-xs mt-0.5 truncate">
                {gmailLoading
                  ? "Checking Gmail connection…"
                  : gmailEmail
                  ? <>Connected to <span className="font-medium text-foreground">{gmailEmail}</span> · Step 1: Fetch · Step 2: Process it → review → send</>
                  : "Not connected — connect your Gmail to start fetching RFQs"}
              </p>
            </div>
            {/* Disconnect / reconnect */}
            {gmailEmail && !gmailLoading && (
              <a
                href="/api/auth/gmail/connect"
                className="text-xs text-muted-foreground hover:text-[#1847F5] underline underline-offset-2 flex-shrink-0"
              >
                Change account
              </a>
            )}
          </div>

          {/* Not connected — show connect button */}
          {!gmailLoading && !gmailEmail && (
            <a
              href="/api/auth/gmail/connect"
              className="w-full h-11 flex items-center justify-center gap-2 rounded-full bg-[#1847F5] text-white text-sm font-semibold shadow-[0_2px_8px_rgba(24,71,245,0.35)] hover:bg-[#0f35d4] transition-colors"
            >
              <Mail className="w-4 h-4" /> Connect your Gmail account
            </a>
          )}

          {/* Connected — show fetch button */}
          {!gmailLoading && gmailEmail && (
            <Button onClick={handleFetch} disabled={fetching}
              className="w-full h-11 bg-[#1847F5] hover:bg-[#0f35d4] text-white font-semibold gap-2 rounded-full shadow-[0_2px_8px_rgba(24,71,245,0.35)]">
              {fetching
                ? <><Loader2 className="w-4 h-4 animate-spin" />
                    {fetchProgress && fetchProgress.total > 0
                      ? `Processing ${fetchProgress.processed} of ${fetchProgress.total}…`
                      : "Scanning Gmail…"}
                  </>
                : <><Mail className="w-4 h-4" />Fetch New Emails</>}
            </Button>
          )}

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
                : `${fetchResults.length} new email${fetchResults.length > 1 ? "s" : ""} fetched. Process them below.`}
            </div>
          )}
        </div>

        {/* ── View mode toggle (All / New mail / Process it / Processed) ── */}
        {(pending.length > 0 || done.length > 0) && (
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-full w-fit overflow-x-auto no-scrollbar">
            {([
              { key: "all",     label: "All",        count: pending.length + done.length, badge: "[#1847F5]" },
              { key: "new",     label: "New mail",   count: newMail.length,                badge: "blue"      },
              { key: "process", label: "Process it", count: processIt.length,              badge: "orange"    },
              { key: "done",    label: "Completed",  count: done.length,                   badge: "green"     },
            ] as { key: ViewMode; label: string; count: number; badge: string }[]).map(({ key, label, count, badge }) => {
              const badgeStyle =
                badge === "blue"   ? "bg-blue-100 text-blue-700"
                : badge === "orange" ? "bg-orange-100 text-orange-700"
                : badge === "green"  ? "bg-green-100 text-green-700"
                : "bg-[#1847F5]/10 text-[#1847F5]";
              return (
                <button
                  key={key}
                  onClick={() => setViewMode(key)}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-all",
                    viewMode === key
                      ? "bg-card text-[#1a1209] shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  <span className={cn(
                    "text-[11px] px-1.5 py-0.5 rounded-full font-bold",
                    viewMode === key ? badgeStyle : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

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
                      ? "bg-[#1847F5] text-white border-[#1847F5] shadow-[0_2px_8px_rgba(24,71,245,0.3)]"
                      : "bg-card text-muted-foreground border-border hover:border-[#1847F5]/40 hover:text-foreground"
                  )}
                >
                  {label}
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full font-semibold",
                    activeFilter === key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground/70"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Pending — AI not yet run (shown in All / New mail / Process it views) ── */}
        {visiblePending.length > 0 && viewMode !== "done" && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-orange-500 cursor-pointer flex-shrink-0"
                  checked={visiblePending.length > 0 && visiblePending.every((r) => batchSelected.has(r.id))}
                  onChange={(e) => {
                    setBatchSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) visiblePending.forEach((r) => next.add(r.id));
                      else visiblePending.forEach((r) => next.delete(r.id));
                      return next;
                    });
                  }}
                  title="Select all"
                  disabled={batchRunning}
                />
                <div className="h-4 w-px bg-orange-400" />
                <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                <span className="font-semibold text-card-foreground text-sm tracking-tight">
                  {viewMode === "new" ? "New Mail (last 24h)" : viewMode === "process" ? "Process it (older)" : "Needs processing"}
                </span>
                <span className="text-[11px] bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full font-semibold">
                  {visiblePending.length}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest hidden sm:block">Newest first</span>
            </div>

            <div className="divide-y divide-border">
              {visiblePending.map((rfq, idx) => (
                <div
                  key={rfq.id}
                  onClick={(e) => {
                    // Shift/Ctrl+click anywhere on the row selects a range or
                    // toggles this one row; a plain click does nothing here —
                    // the checkbox handles that so other row controls (label,
                    // process, delete) keep working normally.
                    if (!e.shiftKey && !(e.ctrlKey || e.metaKey)) return;
                    e.preventDefault();
                    if (e.shiftKey && lastClickedIndexRef.current !== null) {
                      const [start, end] = [lastClickedIndexRef.current, idx].sort((a, b) => a - b);
                      const rangeIds = visiblePending.slice(start, end + 1).map((r) => r.id);
                      setBatchSelected((prev) => {
                        const next = new Set(prev);
                        rangeIds.forEach((id) => next.add(id));
                        return next;
                      });
                    } else {
                      setBatchSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(rfq.id)) next.delete(rfq.id); else next.add(rfq.id);
                        return next;
                      });
                    }
                    lastClickedIndexRef.current = idx;
                  }}
                  className={cn(
                    "flex items-center gap-3 px-5 py-4 transition-colors",
                    batchSelected.has(rfq.id) ? "bg-blue-50/60 dark:bg-blue-950/20 ring-1 ring-inset ring-blue-200 dark:ring-blue-900" :
                      justDone[rfq.id] ? "bg-green-50 dark:bg-green-950/20" : "hover:bg-muted/40",
                    labels[rfq.id] === "spam" && "opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded accent-orange-500 cursor-pointer flex-shrink-0"
                    checked={batchSelected.has(rfq.id)}
                    disabled={batchRunning || processing[rfq.id]}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setBatchSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(rfq.id); else next.delete(rfq.id);
                        return next;
                      });
                      lastClickedIndexRef.current = idx;
                    }}
                  />
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
                      <>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(rfq)}
                          disabled={processing[rfq.id]}
                          title="Remove from dashboard"
                          className="w-8 h-8 flex items-center justify-center rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <Button
                          size="sm"
                          onClick={() => handleProcess(rfq.id)}
                          disabled={processing[rfq.id] || labels[rfq.id] === "spam"}
                          className="bg-[#1847F5] hover:bg-[#0f35d4] text-white gap-1.5 h-8 text-xs rounded-full shadow-[0_2px_8px_rgba(24,71,245,0.3)]"
                        >
                          {processing[rfq.id]
                            ? <><Loader2 className="w-3 h-3 animate-spin" />{processStageLabel(processProgress[rfq.id])}</>
                            : <><Sparkles className="w-3 h-3" />Process it<ArrowRight className="w-3 h-3" /></>}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Done — AI already ran (only shows in All / Processed views) ── */}
        {filteredDone.length > 0 && (viewMode === "all" || viewMode === "done") && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-4 w-px bg-green-400" />
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="font-semibold text-card-foreground text-sm tracking-tight">
                  Completed
                </span>
                <span className="text-[11px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-semibold">
                  {filteredDone.length}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest hidden sm:block">Done</span>
            </div>

            <div className="divide-y divide-border">
              {filteredDone.map((rfq) => (
                <div key={rfq.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors group">
                  {/* Clickable area */}
                  <Link
                    href={`/rfqs/${rfq.id}`}
                    className="flex items-center gap-3 min-w-0 flex-1"
                  >
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-card-foreground text-sm group-hover:text-[#1847F5] transition-colors">{rfq.rfq_code}</p>
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

        {/* Empty state when current view-mode has no items */}
        {pending.length + done.length > 0 && visiblePending.length === 0 && (viewMode === "new" || viewMode === "process") && (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle className="w-7 h-7 mx-auto mb-2 opacity-30" />
            <p className="font-medium">
              {viewMode === "new" ? "Nothing new in the last 24 hours" : "No older backlog — you're caught up!"}
            </p>
            <p className="text-sm mt-1 opacity-70">
              {viewMode === "new" ? "Click \"Fetch New Emails\" to pull the latest." : "All older RFQs have been processed."}
            </p>
          </div>
        )}

        {/* Empty state — no emails at all */}
        {pending.length === 0 && done.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No emails yet</p>
            <p className="text-sm mt-1 opacity-70">
              {gmailEmail
                ? <>Click &quot;Fetch New Emails&quot; to pull your Gmail inbox</>
                : <>Connect Gmail above to start pulling RFQs automatically</>}
            </p>

            {/* Try-a-sample CTA — solves the "I signed up at midnight, no real RFQs yet" problem */}
            <div className="mt-6 inline-flex flex-col items-center gap-1.5">
              <button
                onClick={handleSampleRfq}
                disabled={creatingSample}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-card border border-[#1847F5]/30 text-[#1847F5] text-sm font-semibold hover:bg-[#1847F5]/5 hover:border-[#1847F5] transition-all disabled:opacity-60"
              >
                {creatingSample
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</>
                  : <><Sparkles className="w-4 h-4" />Try with a sample RFQ</>}
              </button>
              <p className="text-[11px] opacity-60">
                Creates a demo RFQ in your account so you can try the full flow now.
              </p>
            </div>
          </div>
        )}

      </main>

      {/* Floating batch action bar */}
      {(batchSelected.size > 0 || batchRunning) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-card border border-border shadow-2xl rounded-2xl px-5 py-3 flex items-center gap-4">
          {batchRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#1847F5]" />
              <span className="text-sm font-medium text-card-foreground">
                {batchProgress ? `Processing ${Math.min(batchProgress.processed + 1, batchProgress.total)} of ${batchProgress.total}…` : "Starting…"}
              </span>
              <Button size="sm" variant="outline" onClick={cancelBatch} className="h-8 text-xs">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-card-foreground">
                {batchSelected.size} RFQ{batchSelected.size > 1 ? "s" : ""} selected
              </span>
              <Button
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                className="bg-red-600 hover:bg-red-700 text-white gap-1.5 h-8 text-xs rounded-full"
              >
                <Trash2 className="w-3 h-3" /> Delete Selected ({batchSelected.size})
              </Button>
              <Button
                size="sm"
                onClick={handleBatchProcess}
                className="bg-[#1847F5] hover:bg-[#0f35d4] text-white gap-1.5 h-8 text-xs rounded-full"
              >
                <Sparkles className="w-3 h-3" /> Process Selected ({batchSelected.size})
              </Button>
              <div className="relative" ref={bulkLabelMenuRef}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBulkLabelOpen((v) => !v)}
                  className="gap-1.5 h-8 text-xs"
                >
                  <Tag className="w-3 h-3" /> Label Selected
                </Button>
                {bulkLabelOpen && (
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl shadow-xl p-1.5 w-44 z-50">
                    {LABELS.map((lbl) => (
                      <button
                        key={lbl.value}
                        onClick={() => bulkSetLabel([...batchSelected], lbl.value)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left text-card-foreground hover:bg-muted/60 transition-colors"
                      >
                        <span className="text-base">{lbl.emoji}</span> {lbl.label}
                      </button>
                    ))}
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={() => bulkSetLabel([...batchSelected], null)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/60 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" /> Remove label
                    </button>
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => setBatchSelected(new Set())} className="h-8 text-xs">
                Clear Selection
              </Button>
            </>
          )}
        </div>
      )}

      {/* Bulk delete confirmation modal */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-950/40 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-card-foreground">Delete {batchSelected.size} RFQ{batchSelected.size > 1 ? "s" : ""} from the dashboard?</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  This will only remove them from ProcureAI. The original emails will remain safely in your Gmail inbox.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={confirmBulkDelete}
                disabled={bulkDeleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {bulkDeleting ? "Deleting..." : "Delete Selected"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkDeleting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
