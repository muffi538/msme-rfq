import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate the next sequential RFQ code, scoped to one user's own account.
 *
 * Format: RFQ-0001, RFQ-0002, ... (zero-padded to 4 digits, padded out to
 * more digits automatically once the account crosses 9999 RFQs).
 *
 * Explicitly filtered by user_id rather than relying on RLS alone — some
 * callers (the Gmail sync cron) use a service-role client that bypasses
 * RLS entirely, and without this filter that path would count every
 * account's RFQs, leaking a cross-account total into another user's code
 * numbering.
 *
 * Race-condition note: if two RFQs are inserted in the same millisecond for
 * the same user (e.g. two tabs), both could grab the same number. rfq_code
 * isn't a unique constraint or a lookup key anywhere in the app (rows are
 * addressed by UUID id), so a rare duplicate display code is cosmetic, not
 * a data-loss risk.
 */
export async function generateRfqCode(supabase: SupabaseClient, userId: string): Promise<string> {
  const { count } = await supabase
    .from("rfqs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const next = (count ?? 0) + 1;
  const padded = String(next).padStart(4, "0");
  return `RFQ-${padded}`;
}
