// Polls /api/jobs/[id] until the background job finishes. Shared by any
// feature that kicks off a job via after() and needs to report progress
// back to the UI (email fetch, RFQ upload).
export async function pollJob<TProgress = unknown, TResult = unknown>(
  jobId: string,
  onProgress: (p: TProgress | null) => void
): Promise<TResult> {
  const POLL_INTERVAL_MS = 1500;
  const MAX_POLLS = 120; // ~3 minutes ceiling, comfortably above maxDuration on the job itself

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error("Lost track of the job. Please try again.");
    const { job } = await res.json();

    onProgress(job.progress ?? null);

    if (job.status === "done") return job.result as TResult;
    if (job.status === "failed") throw new Error(job.error ?? "Job failed");
  }
  throw new Error("This is taking longer than expected. Check back in a bit — it may still finish in the background.");
}
