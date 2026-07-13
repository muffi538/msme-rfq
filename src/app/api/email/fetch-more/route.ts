import { NextRequest, NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { fetchMoreHistory, getGmailRefreshToken, type FetchMoreMode } from "@/lib/email/sync";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob } from "@/lib/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 90;

const VALID_MODES: FetchMoreMode[] = ["50", "100", "30days"];

async function runFetchMoreJob(supabase: SupabaseClient, userId: string, jobId: string, refreshToken: string, mode: FetchMoreMode) {
  try {
    await updateJob(supabase, jobId, { status: "running" });
    const result = await fetchMoreHistory(supabase, userId, refreshToken, mode, (processed, total) => {
      updateJob(supabase, jobId, { progress: { processed, total } });
    });
    await updateJob(supabase, jobId, {
      status: "done",
      progress: { processed: result.fetched, total: result.fetched },
      result,
    });
  } catch (err: unknown) {
    logError("[email-fetch-more] job failed", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    await updateJob(supabase, jobId, { status: "failed", error: msg });
  }
}

// "Fetch More History" — an on-demand backfill (Last 50 / Last 100 / Last
// 30 Days) separate from the regular incremental sync's historyId cursor.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const allowed = await checkRateLimit(supabase, user.id, "email-fetch-more", 300, 5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode;
  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: `mode must be one of ${VALID_MODES.join(", ")}` }, { status: 400 });
  }

  const refreshToken = await getGmailRefreshToken(supabase, user.id);
  if (!refreshToken) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 400 }
    );
  }

  const { job, error: jobError } = await createJob(supabase, user.id, "email_fetch_more");
  if (jobError || !job) {
    logError("[email-fetch-more] could not create job", jobError);
    return NextResponse.json({ error: "Could not start import. Please try again." }, { status: 500 });
  }

  after(() => runFetchMoreJob(supabase, user.id, job.id, refreshToken, mode as FetchMoreMode));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
