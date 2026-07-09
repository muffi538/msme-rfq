"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] unhandled error", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-white font-sans">
        <div className="max-w-md w-full text-center px-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-1.5">
            Something went wrong
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            The app hit an unexpected error loading this page. Please try again.
          </p>
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#1847F5] hover:bg-[#0f35d4] text-white text-sm font-semibold transition-colors"
          >
            Try again
          </button>
          {error.digest && (
            <p className="text-[11px] text-gray-400 mt-6 font-mono">Error ref: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
