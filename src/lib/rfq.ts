import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate the next sequential RFQ code, company-wide.
 *
 * Format: RFQ-0001, RFQ-0002, ... (zero-padded to 4 digits, padded out to
 * more digits automatically once the company crosses 9999 RFQs).
 *
 * Counts every RFQ across every user (RFQs are shared company data, not
 * per-user) and returns count+1, so codes stay unique and sequential no
 * matter who creates the RFQ.
 *
 * Race-condition note: if two RFQs are inserted in the same millisecond by
 * different users, both could grab the same number. rfq_code isn't a unique
 * constraint or a lookup key anywhere in the app (rows are addressed by
 * UUID id), so a rare duplicate display code is cosmetic, not a data-loss
 * risk — acceptable for this app's flow (manual fetch + process).
 */
export async function generateRfqCode(supabase: SupabaseClient): Promise<string> {
  const { count } = await supabase
    .from("rfqs")
    .select("*", { count: "exact", head: true });

  const next = (count ?? 0) + 1;
  const padded = String(next).padStart(4, "0");
  return `RFQ-${padded}`;
}
