"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle, AlertCircle, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type FetchResult  = { rfqCode: string; subject: string; from: string; hasAttachment: boolean };
type PendingRfq   = { id: string; rfq_code: string; buyer_name: string | null; buyer_email: string | null; file_name: string | null; created_at: string };

export default function InboxPage() {
  const router = useRouter();
  const [fetching, setFetching]         = useState(false);
  const [fetchResults, setFetchResults] = useState<FetchResult[] | null>(null);
  const [fetchError, setFetchError]     = useState("");
  const [pending, setPending]           = useState<PendingRfq[]>([]);
  const [processing, setProcessing]     = useState<Record<string, boolean>>({});
  const [done, setDone]                 = useState<Record<string, boolean>>({});

  useEffect(() => { loadPending(); }, []);

  async function loadPending() {
    const res  = await fetch("/api/rfqs/pending");
    if (!res.ok) return;
    const data = await res.json();
    setPending(data.rfqs ?? []);
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
      await loadPending();
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

      // Mark as done, remove from pending list
      setDone((p) => ({ ...p, [rfqId]: true }));
      setProcessing((p) => ({ ...p, [rfqId]: false }));
      setPending((p) => p.filter((r) => r.id !== rfqId));
      toast.success(`${json.itemCount} items extracted!`);

      // Short pause so user sees the ✓ tick, then redirect
      setTimeout(() => router.push(`/rfqs/${rfqId}`), 1200);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
      setProcessing((p) => ({ ...p, [rfqId]: false }));
    }
  }

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

        {/* Pending emails waiting for AI */}
        {pending.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-gray-900">Ready for AI Processing ({pending.length})</span>
              </div>
              <span className="text-xs text-gray-400">Run AI → review items → approve → send</span>
            </div>
            <div className="divide-y divide-gray-50">
              {pending.map((rfq) => (
                <div key={rfq.id} className={`flex items-center justify-between px-6 py-4 transition-colors ${done[rfq.id] ? "bg-green-50" : "hover:bg-gray-50"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800">{rfq.rfq_code}</p>
                    <p className="text-sm text-gray-500 truncate">{rfq.buyer_name ?? rfq.buyer_email ?? "Unknown sender"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {rfq.file_name?.includes("|") ? rfq.file_name.split("|")[1] : rfq.file_name ?? "email body"} · {new Date(rfq.created_at).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  {done[rfq.id] ? (
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
