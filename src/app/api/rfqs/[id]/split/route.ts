import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_TEMPLATE = `Hello {supplier},

We have a new RFQ for you.
RFQ ID: {rfqCode}
Category: {category}

Items:
{items}

Please share your best rate, MOQ, and delivery time.
Reply to this message or email us back.

Thank you.`;

function buildMessage(
  template: string,
  supplierName: string,
  rfqCode: string,
  categories: string[],
  items: { name: string; qty: number | null; unit: string | null; spec: string | null; colour: string | null }[]
): string {
  const itemLines = items
    .map((item, i) => {
      const qty = item.qty != null ? `${item.qty} ${item.unit ?? ""}`.trim() : "TBD";
      const spec = item.spec ? ` (${item.spec})` : "";
      const colour = item.colour ? ` — Colour: ${item.colour}` : "";
      return `${i + 1}. ${item.name}${spec}${colour} — Qty: ${qty}`;
    })
    .join("\n");

  return template
    .replace("{supplier}", supplierName)
    .replace("{rfqCode}", rfqCode)
    .replace("{category}", categories.map((c) => c.replace(/_/g, " ")).join(", "))
    .replace("{items}", itemLines);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await params;
  const startedAt = Date.now();
  console.log(`[rfqs/split] rfq=${rfqId} stage=supplier_split started`);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Load RFQ + items
  const { data: rfq } = await supabase.from("rfqs").select("rfq_code").eq("id", rfqId).single();
  const { data: items } = await supabase
    .from("rfq_items")
    .select("id, name, qty, unit, spec, category, colour")
    .eq("rfq_id", rfqId);

  if (!rfq || !items) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  // Load this user's own message template
  const { data: settingRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .eq("key", "message_template");
  const messageTemplate = settingRows?.[0]?.value ?? DEFAULT_TEMPLATE;

  // Load this user's own suppliers
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, whatsapp_number, email, categories")
    .eq("user_id", user.id)
    .eq("active", true);

  // Delete existing outgoing RFQs for this parent (re-split)
  const { error: clearError } = await supabase.from("outgoing_rfqs").delete().eq("rfq_id", rfqId);
  if (clearError) {
    logError("[rfqs/split] clearing old outgoing rfqs failed", clearError);
    return NextResponse.json({ error: `Could not clear previous split: ${clearError.message}` }, { status: 500 });
  }

  const outgoingRows: unknown[] = [];
  let seq = 1;

  // One outgoing RFQ per SUPPLIER, combining every item across every
  // category that supplier deals in — not one message per category.
  const activeSuppliers = suppliers ?? [];
  const unmatchedItems: typeof items = [];

  for (const item of items) {
    const hasMatch = activeSuppliers.some((s) => s.categories?.includes(item.category));
    if (!hasMatch) unmatchedItems.push(item);
  }

  for (const supplier of activeSuppliers) {
    const supplierItems = items.filter((i) => supplier.categories?.includes(i.category));
    if (supplierItems.length === 0) continue;

    const categories = [...new Set(supplierItems.map((i) => i.category))];
    const childCode = `${rfq.rfq_code}-${categories[0].slice(0, 3)}-${String(seq++).padStart(2, "0")}`;
    const message = buildMessage(messageTemplate, supplier.name, rfq.rfq_code, categories, supplierItems);

    const { data: outgoing, error: outgoingError } = await supabase
      .from("outgoing_rfqs")
      .insert({
        rfq_id: rfqId, user_id: user.id, supplier_id: supplier.id,
        child_code: childCode, category: categories.join(", "), message_body: message,
        channel: supplier.whatsapp_number ? "whatsapp" : "email",
        status: "draft",
      })
      .select("*, suppliers(name, whatsapp_number, email)")
      .single();

    if (outgoingError || !outgoing) {
      logError("[rfqs/split] outgoing_rfqs insert failed", { supplierId: supplier.id, error: outgoingError });
      continue;
    }

    outgoingRows.push(outgoing);
    const itemRows = supplierItems.map((i) => ({
      outgoing_rfq_id: outgoing.id, item_id: i.id, user_id: user.id,
    }));
    const { error: itemsError } = await supabase.from("outgoing_rfq_items").insert(itemRows);
    if (itemsError) logError("[rfqs/split] outgoing_rfq_items insert failed", { supplierId: supplier.id, error: itemsError });
  }

  // Items whose category matched no active supplier — one combined row so
  // staff can see the gap instead of a separate row per empty category.
  if (unmatchedItems.length > 0) {
    const categories = [...new Set(unmatchedItems.map((i) => i.category))];
    const childCode = `${rfq.rfq_code}-${categories[0].slice(0, 3)}-${String(seq++).padStart(2, "0")}`;
    const { data: outgoing, error: outgoingError } = await supabase
      .from("outgoing_rfqs")
      .insert({
        rfq_id: rfqId, user_id: user.id, supplier_id: null,
        child_code: childCode, category: categories.join(", "),
        message_body: null, channel: "whatsapp", status: "no_supplier",
      })
      .select("*, suppliers(name, whatsapp_number, email)")
      .single();
    if (outgoingError || !outgoing) {
      logError("[rfqs/split] outgoing_rfqs insert failed (no supplier)", { error: outgoingError });
    } else {
      outgoingRows.push(outgoing);
      const itemRows = unmatchedItems.map((i) => ({
        outgoing_rfq_id: outgoing.id, item_id: i.id, user_id: user.id,
      }));
      const { error: itemsError } = await supabase.from("outgoing_rfq_items").insert(itemRows);
      if (itemsError) logError("[rfqs/split] outgoing_rfq_items insert failed (no supplier)", { error: itemsError });
    }
  }

  // Mark parent RFQ as approved
  const { error: statusError } = await supabase.from("rfqs").update({ status: "approved" }).eq("id", rfqId);
  if (statusError) logError("[rfqs/split] status update failed", statusError);

  console.log(`[rfqs/split] rfq=${rfqId} stage=supplier_split completed in ${Date.now() - startedAt}ms, outgoing=${outgoingRows.length}`);
  return NextResponse.json({ outgoing: outgoingRows });
}
