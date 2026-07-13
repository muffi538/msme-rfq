import { NextRequest, NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { bootstrapGmailSync, getGmailRefreshToken } from "@/lib/email/sync";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob } from "@/lib/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const VALID_COUNTS = [0, 25, 50, 100] as const;
type Count = typeof VALID_COUNTS[number];

async function runOnboardJob(supabase: SupabaseClient, userId: string, jobId: string, refreshToken: string, count: Count) {
  try {
    await updateJob(supabase, jobId, { status: "running" });
    const result = await bootstrapGmailSync(supabase, userId, refreshToken, count, (processed, total) => {
      updateJob(supabase, jobId, { progress: { processed, total } });
    });
    await updateJob(supabase, jobId, {
      status: "done",
      progress: { processed: result.fetched, total: result.fetched },
      result,
    });
  } catch (err: unknown) {
    logError("[email-onboard] job failed", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    await updateJob(supabase, jobId, { status: "failed", error: msg });
  }
}

// First-connect onboarding — the user picks how much history to import
// (Last 25/50/100, or 0 to start clean) right after connecting Gmail.
// After this, auto-sync takes over via the cron.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const allowed = await checkRateLimit(supabase, user.id, "email-onboard", 300, 5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const count = body.count;
  if (!VALID_COUNTS.includes(count)) {
    return NextResponse.json({ error: "count must be 0, 25, 50, or 100" }, { status: 400 });
  }

  const refreshToken = await getGmailRefreshToken(supabase, user.id);
  if (!refreshToken) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 400 }
    );
  }

  const { job, error: jobError } = await createJob(supabase, user.id, "email_onboard");
  if (jobError || !job) {
    logError("[email-onboard] could not create job", jobError);
    return NextResponse.json({ error: "Could not start import. Please try again." }, { status: 500 });
  }

  after(() => runOnboardJob(supabase, user.id, job.id, refreshToken, count as Count));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
