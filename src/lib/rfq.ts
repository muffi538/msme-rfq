import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate the next sequential RFQ code for a given user.
 *
 * Format: RFQ-0001, RFQ-0002, ... (zero-padded to 4 digits, padded out to
 * more digits automatically once the user crosses 9999 RFQs).
 *
 * Counts how many RFQs the user already has and returns count+1. Each user
 * has their own independent sequence, so client A's RFQ-0042 and client B's
 * RFQ-0042 don't collide (they live in different rows scoped by user_id).
 *
 * Race-condition note: if two RFQs are inserted in the same millisecond for
 * the same user, both could grab the same number. For this app's flow
 * (manual fetch + process), that's acceptable.
 */
export async function generateRfqCode(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { count } = await supabase
    .from("rfqs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const next = (count ?? 0) + 1;
  const padded = String(next).padStart(4, "0");
  return `RFQ-${padded}`;
}
