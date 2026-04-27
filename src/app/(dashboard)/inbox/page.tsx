"use client";

import { useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle, AlertCircle, ArrowRight, Inbox } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type FetchResult = {
  rfqCode: string;
  subject: string;
  itemCount: number;
};

export default function InboxPage() {
  const [fetching, setFetching] = useState(false);
  const [results, setResults]   = useState<FetchResult[] | null>(null);
  const [error, setError]       = useState("");

  async function handleFetch() {
    setFetching(true);
    setError("");
    setResults(null);

    try {
      const res  = await fetch("/api/email/fetch", { method: "POST" });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? "Fetch failed");

      setResults(json.results ?? []);

      if (json.created === 0) {
        toast.info("No new emails found in your inbox.");
      } else {
        toast.success(`${json.created} RFQ${json.created > 1 ? "s" : ""} imported from Gmail!`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast.error(msg);
    } finally {
      setFetching(false);
    }
  }

  return (
    <>
      <DashboardHeader title="Email Inbox" />
      <main className="flex-1 p-8 max-w-2xl mx-auto w-full">

        {/* Connection card */}
        <div className="bg-white rounded-2xl border border-gray-100 p-8 mb-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Mail className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">Gmail RFQ Importer</h2>
              <p className="text-gray-500 text-sm mt-1">
                Connected to <span className="font-medium text-gray-700">{process.env.NEXT_PUBLIC_GMAIL_DISPLAY ?? "mufaddal66you@gmail.com"}</span>
              </p>
              <p className="text-gray-400 text-xs mt-1">
                Fetches unread emails, extracts attachments, and runs them through the AI pipeline automatically.
              </p>
            </div>
          </div>

          <Button
            onClick={handleFetch}
            disabled={fetching}
            className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base gap-2"
          >
            {fetching ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Fetching & processing emails...</>
            ) : (
              <><Mail className="w-4 h-4" /> Fetch New RFQs from Gmail</>
            )}
          </Button>

          {fetching && (
            <p className="text-center text-xs text-gray-400 mt-3">
              Connecting to Gmail → parsing attachments → running AI → saving to dashboard...
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 text-red-700 rounded-xl px-5 py-4 mb-6 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Something went wrong</p>
              <p className="text-red-500 text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Results */}
        {results !== null && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="font-semibold text-gray-900">
                {results.length === 0 ? "No new emails" : `${results.length} RFQ${results.length > 1 ? "s" : ""} imported`}
              </span>
            </div>

            {results.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center">
                <Inbox className="w-10 h-10 text-gray-200 mb-3" />
                <p className="text-gray-400 text-sm">Your inbox is up to date — no new unread emails.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {results.map((r) => (
                  <div key={r.rfqCode} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50">
                    <div>
                      <p className="font-medium text-gray-800">{r.rfqCode}</p>
                      <p className="text-sm text-gray-500 truncate max-w-xs">{r.subject}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{r.itemCount} items extracted</p>
                    </div>
                    <Link
                      href="/rfqs"
                      className="flex items-center gap-1 text-blue-600 text-sm font-medium hover:underline"
                    >
                      View <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="mt-6 bg-blue-50 rounded-2xl p-6">
          <h3 className="font-semibold text-gray-900 mb-3 text-sm">How this works</h3>
          <ol className="space-y-2 text-sm text-gray-600">
            {[
              "Connects to mufaddal66you@gmail.com via secure IMAP",
              "Reads unread emails and downloads attachments (PDF, Excel, images)",
              "AI extracts every item with quantity, unit, and spec",
              "Each item is auto-categorised into one of 12 categories",
              "RFQ appears in your dashboard ready for supplier split",
              "Email is marked as read so it won't be imported again",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </main>
    </>
  );
}
