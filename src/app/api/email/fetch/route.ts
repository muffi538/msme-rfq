import { NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { syncGmailForUser } from "@/lib/email/sync";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob } from "@/lib/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

// "Fetch Now" — the manual backup to the every-2-minute cron sync (see
// /api/cron/gmail-sync). Both call the same syncGmailForUser core so
// dedup/checkpointing behave identically regardless of which one runs.
async function runEmailFetchJob(supabase: SupabaseClient, userId: string, jobId: string, refreshToken: string) {
  try {
    await updateJob(supabase, jobId, { status: "running" });

    const result = await syncGmailForUser(supabase, userId, refreshToken, (processed, total) => {
      updateJob(supabase, jobId, { progress: { processed, total } });
    });

    console.log("[email-fetch] done", result);
    await updateJob(supabase, jobId, {
      status: "done",
      progress: { processed: result.fetched, total: result.fetched },
      result,
    });
  } catch (err: unknown) {
    logError("Email fetch job failed:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    await updateJob(supabase, jobId, { status: "failed", error: msg });
  }
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Each fetch can trigger up to 20 Gmail API calls plus OpenAI fallback
  // calls — cap how often it can be triggered.
  const allowed = await checkRateLimit(supabase, user.id, "email-fetch", 300, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many fetch requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  // Look up this user's own Gmail refresh token.
  // .limit(1) instead of .single() — a duplicate row for this user_id+key
  // would make .single() error out and look like "not connected".
  const { data: tokenRows, error: tokenLookupError } = await supabase
    .from("user_settings")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", "gmail_refresh_token")
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokenLookupError) logError("[email-fetch] token lookup failed", tokenLookupError);
  const refreshToken = tokenRows?.[0]?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 400 }
    );
  }

  const { job, error: jobError } = await createJob(supabase, user.id, "email_fetch");
  if (jobError || !job) {
    logError("[email-fetch] could not create job", jobError);
    return NextResponse.json({ error: "Could not start email fetch. Please try again." }, { status: 500 });
  }

  // Runs after this response is sent — the client gets the job id back
  // immediately and polls /api/jobs/[id] instead of waiting on this request.
  after(() => runEmailFetchJob(supabase, user.id, job.id, refreshToken));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
