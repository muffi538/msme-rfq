import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logError";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by GET (load-for-import) and POST (save draft) — resolves a
// quotation to two decimal places consistently, so what the client shows
// and what gets persisted never drift from floating-point rounding.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type ItemInput = {
  id?: string;
  itemId?: string | null;
  lineNumber: number;
  name: string;
  qty: number | null;
  unit: string | null;
  spec: string | null;
  brandOffered: string | null;
  unitPrice: number | null;
  discountPercent: number | null;
  leadTime: string | null;
  deliveryTime: string | null;
  remarks: string | null;
};

// Recomputes every total server-side from the item rows — the client's own
// running totals are for instant UI feedback only, never trusted as the
// value actually persisted (a stale tab, a manual API call, or a client
// bug could otherwise silently corrupt the quotation total).
function computeTotals(items: ItemInput[], headerDiscountPercent: number, taxPercent: number) {
  const lineTotals = items.map((it) => {
    const qty = it.qty ?? 0;
    const price = it.unitPrice ?? 0;
    const discount = it.discountPercent ?? 0;
    return round2(qty * price * (1 - discount / 100));
  });
  const subtotal = round2(lineTotals.reduce((sum, t) => sum + t, 0));
  const discounted = round2(subtotal * (1 - headerDiscountPercent / 100));
  const taxAmount = round2(discounted * (taxPercent / 100));
  const grandTotal = round2(discounted + taxAmount);
  return { lineTotals, subtotal, taxAmount, grandTotal };
}

async function assertRfqOwnership(supabase: SupabaseClient, rfqId: string): Promise<boolean> {
  const { data } = await supabase.from("rfqs").select("id").eq("id", rfqId).maybeSingle();
  return !!data;
}

// Loads everything the "Import Existing RFQ" table needs for one RFQ: the
// RFQ's own line items (read-only source of truth: product/qty/unit/spec)
// plus any in-progress draft quotation already saved for it, so reopening
// the picker resumes exactly where the user left off instead of starting
// the pricing table over.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const rfqId = request.nextUrl.searchParams.get("rfqId");
  if (!rfqId) return NextResponse.json({ error: "rfqId is required" }, { status: 400 });

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, status, gmail_message_id, gmail_thread_id, source_rfq_number")
    .eq("id", rfqId)
    .maybeSingle();
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  // Root cause of a real reported bug: once a quotation is sent, its row
  // flips from 'draft' to 'sent' and stops matching the draft query below,
  // so reopening "Import Existing RFQ" for that RFQ found no draft and
  // silently reset the whole table to blank pricing — pricing already
  // typed once for that RFQ was effectively gone. This always fetches the
  // most recent SENT quotation alongside the draft query (can't
  // conditionally skip it based on the draft's own result within the same
  // Promise.all — that would be a circular reference); the result is only
  // used below when there's no active draft.
  const [{ data: rfqItems }, { data: draft }, { data: sentReplies }] = await Promise.all([
    supabase
      .from("rfq_items")
      .select("id, line_number, name, qty, unit, spec, brand")
      .eq("rfq_id", rfqId)
      .order("line_number"),
    supabase
      .from("quotation_replies")
      .select("*")
      .eq("rfq_id", rfqId)
      .eq("status", "draft")
      .maybeSingle(),
    supabase
      .from("quotation_replies")
      .select("id")
      .eq("rfq_id", rfqId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1),
  ]);

  let draftItems: unknown[] = [];
  if (draft) {
    const { data } = await supabase
      .from("quotation_reply_items")
      .select("*")
      .eq("quotation_reply_id", draft.id)
      .order("line_number");
    draftItems = data ?? [];
  }

  // Pricing carried over from the most recently sent quotation for this
  // RFQ — a starting point to edit/resend from, NOT the record itself
  // (returned separately from `draft` so the client never mistakes it for
  // an in-progress draft to overwrite; saving creates a fresh row, leaving
  // the original sent quotation's history intact).
  let lastSentItems: unknown[] = [];
  const lastSentId = draft ? undefined : sentReplies?.[0]?.id;
  if (lastSentId) {
    const { data } = await supabase
      .from("quotation_reply_items")
      .select("*")
      .eq("quotation_reply_id", lastSentId)
      .order("line_number");
    lastSentItems = data ?? [];
  }

  return NextResponse.json({
    rfq,
    rfqItems: rfqItems ?? [],
    draft: draft ? { ...draft, items: draftItems } : null,
    lastSentItems: lastSentId ? lastSentItems : null,
  });
}

// Creates or updates a DRAFT quotation reply. Finding-then-updating an
// existing draft (rather than relying on the DB's partial unique index to
// reject a duplicate insert) keeps "save draft" idempotent from the
// client's point of view — calling it repeatedly while editing a 100+ item
// table always converges on the same one row per RFQ instead of erroring
// on the second save.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json() as {
    id?: string;
    rfqId?: string | null;
    source: "external" | "imported";
    supplierName?: string | null;
    buyerEmail: string;
    buyerName?: string | null;
    emailSubject?: string | null;
    emailBody?: string | null;
    currency?: string;
    taxPercent?: number;
    discountPercent?: number;
    validityDays?: number | null;
    paymentTerms?: string | null;
    items: ItemInput[];
  };

  if (!body.buyerEmail?.trim()) {
    return NextResponse.json({ error: "Buyer email is required" }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }
  if (body.rfqId && !(await assertRfqOwnership(supabase, body.rfqId))) {
    return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
  }

  const taxPercent = body.taxPercent ?? 0;
  const discountPercent = body.discountPercent ?? 0;
  const { lineTotals, subtotal, taxAmount, grandTotal } = computeTotals(body.items, discountPercent, taxPercent);

  // Resolve which row to write to: the id the client already has, else the
  // existing draft for this RFQ (if any — same "resume, don't duplicate"
  // reasoning as the GET route above), else a fresh insert.
  let quotationReplyId = body.id;
  if (!quotationReplyId && body.rfqId) {
    const { data: existingDraft } = await supabase
      .from("quotation_replies")
      .select("id")
      .eq("rfq_id", body.rfqId)
      .eq("status", "draft")
      .maybeSingle();
    quotationReplyId = existingDraft?.id;
  }

  const headerRow = {
    user_id:          user.id,
    rfq_id:            body.rfqId ?? null,
    source:            body.source,
    status:            "draft" as const,
    supplier_name:     body.supplierName ?? null,
    buyer_email:       body.buyerEmail.trim(),
    buyer_name:        body.buyerName ?? null,
    email_subject:     body.emailSubject ?? null,
    email_body:        body.emailBody ?? null,
    currency:          body.currency ?? "INR",
    tax_percent:       taxPercent,
    discount_percent:  discountPercent,
    subtotal,
    tax_amount:        taxAmount,
    grand_total:       grandTotal,
    validity_days:     body.validityDays ?? null,
    payment_terms:     body.paymentTerms ?? null,
    updated_at:        new Date().toISOString(),
  };

  try {
    if (quotationReplyId) {
      const { error: updateError } = await supabase
        .from("quotation_replies")
        .update(headerRow)
        .eq("id", quotationReplyId);
      if (updateError) throw updateError;

      // Simplest correct approach for reordering/partial edits across
      // potentially 100+ items — delete + reinsert in one request. Same
      // pattern already used by the outgoing-RFQ supplier split
      // (src/app/api/rfqs/[id]/split/route.ts) for the same reason.
      const { error: deleteError } = await supabase
        .from("quotation_reply_items")
        .delete()
        .eq("quotation_reply_id", quotationReplyId);
      if (deleteError) throw deleteError;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("quotation_replies")
        .insert(headerRow)
        .select("id")
        .single();
      if (insertError) throw insertError;
      quotationReplyId = inserted.id;
    }

    if (body.items.length > 0) {
      const itemRows = body.items.map((it, i) => ({
        quotation_reply_id: quotationReplyId,
        user_id:            user.id,
        item_id:             it.itemId ?? null,
        line_number:         it.lineNumber,
        name:                it.name,
        qty:                 it.qty,
        unit:                it.unit,
        spec:                it.spec,
        brand_offered:       it.brandOffered,
        unit_price:          it.unitPrice,
        discount_percent:    it.discountPercent ?? 0,
        lead_time:           it.leadTime,
        delivery_time:       it.deliveryTime,
        remarks:             it.remarks,
        line_total:          lineTotals[i],
      }));
      const { error: itemsError } = await supabase.from("quotation_reply_items").insert(itemRows);
      if (itemsError) throw itemsError;
    }

    return NextResponse.json({ id: quotationReplyId, subtotal, taxAmount, grandTotal });
  } catch (err) {
    logError("[rfq-reply/quotation] save failed", err);
    return NextResponse.json({ error: "Could not save the draft. Please try again." }, { status: 500 });
  }
}
