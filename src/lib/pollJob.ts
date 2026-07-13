import { apiFetch } from "@/lib/apiFetch";

// Polls /api/jobs/[id] until the background job finishes. Shared by any
// feature that kicks off a job via after() and needs to report progress
// back to the UI (email fetch, RFQ upload). Accepts an optional AbortSignal
// so a caller can stop polling (e.g. on unmount, or a user-initiated
// cancel) instead of it running to completion in the background
// regardless — the job itself keeps running server-side either way, this
// only stops wasted client-side polling.
export async function pollJob<TProgress = unknown, TResult = unknown>(
  jobId: string,
  onProgress: (p: TProgress | null) => void,
  signal?: AbortSignal
): Promise<TResult> {
  const POLL_INTERVAL_MS = 1500;
  const MAX_POLLS = 120; // ~3 minutes ceiling, comfortably above maxDuration on the job itself

  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) throw new DOMException("Polling cancelled", "AbortError");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (signal?.aborted) throw new DOMException("Polling cancelled", "AbortError");
    // A multi-minute poll loop is exactly the kind of long-lived, often
    // backgrounded request that can outlive the session cookie's freshness
    // — apiFetch recovers from that with one session-refresh-and-retry
    // instead of the whole poll dying on a stale "Unauthorised".
    const res = await apiFetch(`/api/jobs/${jobId}`, { signal });
    if (!res.ok) throw new Error("Lost track of the job. Please try again.");
    const { job } = await res.json();

    onProgress(job.progress ?? null);

    if (job.status === "done") return job.result as TResult;
    if (job.status === "failed") throw new Error(job.error ?? "Job failed");
  }
  throw new Error("This is taking longer than expected. Check back in a bit — it may still finish in the background.");
}
