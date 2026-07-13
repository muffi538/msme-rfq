import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logError";

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export type Job = {
  id: string;
  user_id: string;
  type: string;
  status: JobStatus;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  rfq_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function createJob(
  supabase: SupabaseClient,
  userId: string,
  type: string,
  rfqId?: string
): Promise<{ job: Job | null; error: string | null }> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({ user_id: userId, type, status: "pending", rfq_id: rfqId ?? null })
    .select()
    .single();

  if (error) return { job: null, error: error.message };
  return { job: data as Job, error: null };
}

// Idempotency check: is there already a not-yet-finished job for this RFQ?
// Used to avoid kicking off a second, duplicate processing run for the
// same RFQ (e.g. a double-click, or two browser tabs both hitting
// "Process it" on the same row).
export async function findActiveJobForRfq(
  supabase: SupabaseClient,
  userId: string,
  rfqId: string
): Promise<Job | null> {
  const { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("rfq_id", rfqId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Job | null) ?? null;
}

export async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Partial<Pick<Job, "status" | "progress" | "result" | "error">>
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  // Best-effort — if this fails there's nothing more useful to do than log
  // it; the job row simply won't reflect the latest state and the client's
  // poll will eventually see a stale-but-not-wrong status.
  if (error) logError("[jobs] update failed", { jobId, patch, error });
}
