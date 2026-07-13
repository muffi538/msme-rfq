import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logError";

// Comfortably above JOB_DEADLINE_MS (100s) in the process route — under
// normal operation a stuck job already fails cleanly well before this,
// so anything still "processing" past this point is a genuinely orphaned
// lock (the function got killed hard, before even its own deadline race
// could run), not a real still-in-progress job.
const STALE_PROCESSING_MS = 5 * 60 * 1000;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // "failed" RFQs stay here too (not silently dropped) so the user can see
  // and retry them instead of them disappearing after a failed run.
  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, file_name, created_at, updated_at, status, process_error")
    .eq("user_id", user.id)
    .in("status", ["pending", "needs_processing", "processing", "failed"])
    .eq("hidden_from_dashboard", false)
    .order("created_at", { ascending: false, nullsFirst: false });

  // Self-healing: automatically clear stale "processing" locks instead of
  // leaving a "Processing (another session)" pill stuck forever waiting for
  // someone to click "Process it" again before the staleness check there
  // even runs. Fires on every load of this list, not just on a fresh
  // process attempt.
  const now = Date.now();
  const stale = (rfqs ?? []).filter((r) =>
    r.status === "processing" && r.updated_at && now - new Date(r.updated_at).getTime() > STALE_PROCESSING_MS
  );

  if (stale.length > 0) {
    const staleIds = stale.map((r) => r.id);
    const timeoutMessage = "Processing timed out and was automatically stopped. Please try again.";

    const { error: rfqError } = await supabase
      .from("rfqs")
      .update({ status: "failed", process_error: timeoutMessage })
      .in("id", staleIds)
      .eq("status", "processing"); // only flip rows still actually stuck — a real run that finished between the read above and this write shouldn't get clobbered

    if (rfqError) {
      logError("[rfqs/pending] failed to clear stale processing locks", rfqError);
    } else {
      for (const r of stale) { r.status = "failed"; r.process_error = timeoutMessage; }
    }

    // Also fail any matching orphaned job rows so a future process attempt's
    // idempotency check (findActiveJobForRfq) stops treating them as active.
    const { error: jobError } = await supabase
      .from("jobs")
      .update({ status: "failed", error: timeoutMessage })
      .in("rfq_id", staleIds)
      .in("status", ["pending", "running"]);
    if (jobError) logError("[rfqs/pending] failed to clear stale job locks", jobError);
  }

  return NextResponse.json({ rfqs: rfqs ?? [] });
}
