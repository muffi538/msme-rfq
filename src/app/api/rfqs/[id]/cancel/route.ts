import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logError";

// User-initiated cancel for a stuck or unwanted "processing" RFQ. Reuses the
// existing "failed" terminal state (with a distinct, clear message) rather
// than introducing a separate "cancelled" status throughout the app — every
// place that already knows how to show/retry a failed RFQ handles this for
// free. Marks BOTH the RFQ and any of this user's still-active jobs for it,
// so a stuck client-side poll resolves (as a clean failure) within one poll
// interval instead of running out its own timeout.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: rfq } = await supabase.from("rfqs").select("id, status").eq("id", id).maybeSingle();
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  if (rfq.status !== "processing") {
    // Nothing to cancel — already finished, failed, or never started.
    // Idempotent no-op rather than an error, since the client may race a
    // cancel click against the job finishing on its own.
    return NextResponse.json({ ok: true, alreadyTerminal: true });
  }

  const message = "Cancelled by user.";

  const { error: rfqError } = await supabase
    .from("rfqs")
    .update({ status: "failed", process_error: message })
    .eq("id", id)
    .eq("status", "processing"); // only if it's still actually processing at write time
  if (rfqError) {
    logError("[rfqs/cancel] failed to update rfq", rfqError);
    return NextResponse.json({ error: "Could not cancel processing. Please try again." }, { status: 500 });
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("rfq_id", id)
    .in("status", ["pending", "running"]);
  if (jobError) logError("[rfqs/cancel] failed to update job", jobError);

  return NextResponse.json({ ok: true });
}
