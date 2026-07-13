import { NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { syncGmailForUser, getGmailRefreshToken } from "@/lib/email/sync";
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

    const result = await syncGmailForUser(supabase, userId, refreshToken, {
      isManual: true,
      onProgress: (processed, total) => updateJob(supabase, jobId, { progress: { processed, total } }),
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

  // Each fetch can trigger a handful of Gmail API calls — cap how often it
  // can be triggered.
  const allowed = await checkRateLimit(supabase, user.id, "email-fetch", 300, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many fetch requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  const refreshToken = await getGmailRefreshToken(supabase, user.id);
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
