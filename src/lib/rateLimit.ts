import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lightweight per-user rate limiter backed by a single atomic Postgres
 * function (see supabase/migration_hardening.sql) — no Redis needed at
 * single-customer scale. Fails open (allows the request) if the limiter
 * itself errors, so a DB hiccup never blocks a legitimate user.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  bucket: string,
  windowSeconds: number,
  maxRequests: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_user_id: userId,
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });

  if (error) {
    console.error("[rate-limit] check failed, failing open", { bucket, error });
    return true;
  }

  return data === true;
}
