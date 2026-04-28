"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle, AlertCircle, Sparkles, ArrowRight, Clock } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type FetchResult  = { rfqCode: string; subject: string; from: string; hasAttachment: boolean };
type PendingRfq   = { id: string; rfq_code: string; buyer_name: string | null; buyer_email: string | null; file_name: string | null; created_at: string };
type DoneRfq      = { id: string; rfq_code: string; buyer_name: string | null; status: string; created_at: string };

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN")} · ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function InboxPage() {
  const router = useRouter();
  const [fetching, setFetching]         = useState(false);
  const [fetchResults, setFetchResults] = useState<FetchResult[] | null>(null);
  const [fetchError, setFetchError]     = useState("");
  const [pending, setPending]           = useState<PendingRfq[]>([]);
  const [done, setDone]                 = useState<DoneRfq[]>([]);
  const [processing, setProcessing]     = useState<Record<string, boolean>>({});
  const [justDone, setJustDone]         = useState<Record<string, boolean>>({});

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    await Promise.all([loadPending(), loadDone()]);
  }

  async function loadPending() {
    const res  = await fetch("/api/rfqs/pending");
    if (!res.ok) return;
    const data = await res.json();
    setPending(data.rfqs ?? []);
  }

  async function loadDone() {
    // Fetch last 20 processed/approved/sent RFQs from email (file_name starts with msgid:)
    const supabase = createClient();
    const { data } = await supabase
      .from("rfqs")
      .select("id, rfq_code, buyer_name, status, created_at")
      .in("status", ["processed", "approved", "sent"])
      .like("file_name", "msgid:%")
      .order("created_at", { ascending: false })
      .limit(20);
    setDone(data ?? []);
  }

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
      else toast.success(`${json.created} email${json.created > 1 ? "s" : ""} fetched! Run AI to extract items.`);
      await loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setFetching(false);
    }
  }

  async function handleProcess(rfqId: string) {
    setProcessing((p) => ({ ...p, [rfqId]: true }));
    try {
      const res  = await fetch(`/api/rfqs/${rfqId}/process`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Processing failed");

      setJustDone((p) => ({ ...p, [rfqId]: true }));
      setProcessing((p) => ({ ...p, [rfqId]: false }));
      // Move from pending to done list
      const moved = pending.find((r) => r.id === rfqId);
      setPending((p) => p.filter((r) => r.id !== rfqId));
      if (moved) {
        setDone((prev) => [{ id: moved.id, rfq_code: moved.rfq_code, buyer_name: moved.buyer_name, status: "processed", created_at: moved.created_at }, ...prev]);
      }
      toast.success(`${json.itemCount} items extracted! Opening in new tab…`);
      // Open RFQ in a new tab so the inbox stays open
      setTimeout(() => window.open(`/rfqs/${rfqId}`, "_blank"), 800);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
      setProcessing((p) => ({ ...p, [rfqId]: false }));
    }
  }

  const statusLabel: Record<string, string> = {
    processed: "AI done",
    approved:  "Approved",
    sent:      "Sent",
  };

  return (
    <>
      <DashboardHeader title="Email Inbox" />
      <main className="flex-1 p-8 max-w-3xl mx-auto w-full space-y-6">

        {/* Fetch card */}
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Mail className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">Gmail RFQ Importer</h2>
              <p className="text-gray-500 text-sm mt-1">Connected to <span className="font-medium text-gray-700">mufaddal66you@gmail.com</span></p>
              <p className="text-gray-400 text-xs mt-1">Step 1: Fetch emails. Step 2: Run AI → review items → send to suppliers.</p>
            </div>
          </div>

          <Button onClick={handleFetch} disabled={fetching}
            className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base gap-2">
            {fetching
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting to Gmail...</>
              : <><Mail className="w-4 h-4" /> Fetch New Emails</>}
          </Button>

          {fetchError && (
            <div className="flex items-start gap-3 bg-red-50 text-red-700 rounded-xl px-4 py-3 mt-4 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Fetch failed</p>
                <p className="text-red-500 text-xs mt-0.5">{fetchError}</p>
              </div>
            </div>
          )}

          {fetchResults !== null && !fetchError && (
            <div className="mt-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl px-4 py-3">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              {fetchResults.length === 0
                ? "Inbox is up to date — no new emails."
                : `${fetchResults.length} new email${fetchResults.length > 1 ? "s" : ""} fetched. Click "Run AI" below to extract items.`}
            </div>
          )}
        </div>

        {/* Pending — newest first */}
        {pending.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-gray-900">Ready for AI Processing ({pending.length})</span>
              </div>
              <span className="text-xs text-gray-400">Newest first · Run AI → review → approve → send</span>
            </div>
            <div className="divide-y divide-gray-50">
              {pending.map((rfq) => (
                <div key={rfq.id} className={`flex items-center justify-between px-6 py-4 transition-colors ${justDone[rfq.id] ? "bg-green-50" : "hover:bg-gray-50"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800">{rfq.rfq_code}</p>
                    <p className="text-sm text-gray-500 truncate">{rfq.buyer_name ?? rfq.buyer_email ?? "Unknown sender"}</p>
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {fmt(rfq.created_at)}
                    </p>
                  </div>
                  {justDone[rfq.id] ? (
                    <div className="ml-4 flex items-center gap-1.5 text-green-600 text-sm font-medium">
                      <CheckCircle className="w-4 h-4" /> Done — opening...
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleProcess(rfq.id)}
                      disabled={processing[rfq.id]}
                      className="ml-4 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 flex-shrink-0"
                    >
                      {processing[rfq.id]
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Processing...</>
                        : <><Sparkles className="w-3 h-3" /> Run AI <ArrowRight className="w-3 h-3" /></>}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Already processed — with tick */}
        {done.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="font-semibold text-gray-900">Already Processed ({done.length})</span>
              </div>
              <span className="text-xs text-gray-400">AI has already run on these</span>
            </div>
            <div className="divide-y divide-gray-50">
              {done.map((rfq) => (
                <Link
                  key={rfq.id}
                  href={`/rfqs/${rfq.id}`}
                  target="_blank"
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-700 text-sm">{rfq.rfq_code}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {fmt(rfq.created_at)}
                        {rfq.buyer_name && <span className="ml-1">· {rfq.buyer_name}</span>}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-4 ${
                    rfq.status === "sent"     ? "bg-gray-100 text-gray-600" :
                    rfq.status === "approved" ? "bg-indigo-100 text-indigo-700" :
                                               "bg-green-100 text-green-700"
                  }`}>
                    {statusLabel[rfq.status] ?? rfq.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-blue-50 rounded-2xl p-6">
          <h3 className="font-semibold text-gray-900 mb-3 text-sm">How this works</h3>
          <ol className="space-y-2 text-sm text-gray-600">
            {[
              "Click 'Fetch New Emails' — connects to Gmail and downloads attachments",
              "Emails appear above as 'Ready for AI Processing'",
              "Click 'Run AI' — AI extracts & categorises all items from the RFQ",
              "You're taken to the RFQ page to review items and split by supplier",
              "Approve and send WhatsApp messages to each supplier",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="text-xs text-gray-400 mt-4">
            Tip: You can also upload RFQ files directly via{" "}
            <Link href="/rfqs/upload" className="text-blue-600 hover:underline">Upload RFQ</Link>.
          </p>
        </div>

      </main>
    </>
  );
}
