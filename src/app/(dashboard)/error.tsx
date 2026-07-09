"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] unhandled error", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h1 className="text-lg font-semibold text-card-foreground mb-1.5">
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          This page hit an unexpected error. Your data is safe — try again, or head back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#1847F5] hover:bg-[#0f35d4] text-white text-sm font-semibold shadow-[0_2px_8px_rgba(24,71,245,0.35)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
        {error.digest && (
          <p className="text-[11px] text-muted-foreground/60 mt-6 font-mono">Error ref: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
