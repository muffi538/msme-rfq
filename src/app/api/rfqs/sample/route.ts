import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRfqCode } from "@/lib/rfq";

/**
 * Creates a realistic-looking sample RFQ in the user's account so first-time
 * users (especially night-time signups with no real inbox traffic yet) can
 * try the full process → split → send flow without waiting for a real email.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const rfqCode = await generateRfqCode(supabase, user.id);

  const sampleText = `
Subject: Quotation Required — Site Hardware Order

Dear Sir,

Please quote your best price for the following items required at our Andheri site:

1. Drill machine (Bosch GBM-10) — 2 nos
2. Hammer 1.5 lb — 5 nos
3. Wood screws 50mm pack of 100 — 10 packs
4. PVC pipe 1 inch x 10 ft — 20 lengths
5. Wall paint white emulsion 20L — 4 buckets
6. Safety helmet ISI marked — 8 nos
7. Cotton gloves — 25 pairs

Delivery required within 5 days. Please share GST invoice format.

Regards,
Ramesh Sharma
Sharma Construction Pvt Ltd
9876543210
  `.trim();

  const { data: rfq, error } = await supabase
    .from("rfqs")
    .insert({
      user_id:     user.id,
      rfq_code:    rfqCode,
      buyer_name:  "Ramesh Sharma (Sample)",
      buyer_email: "sample@procur.ai",
      file_name:   `sample:${Date.now()}`,
      file_type:   "text",
      raw_text:    sampleText,
      status:      "pending",
      priority:    "normal",
    })
    .select("id, rfq_code")
    .single();

  if (error || !rfq) {
    return NextResponse.json({ error: error?.message ?? "Could not create sample" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rfq });
}
