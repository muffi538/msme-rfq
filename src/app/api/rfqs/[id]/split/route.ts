import { NextRequest, NextResponse } from "next/server";
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
  category: string,
  items: { name: string; qty: number | null; unit: string | null; spec: string | null }[]
): string {
  const itemLines = items
    .map((item, i) => {
      const qty = item.qty != null ? `${item.qty} ${item.unit ?? ""}`.trim() : "TBD";
      const spec = item.spec ? ` (${item.spec})` : "";
      return `${i + 1}. ${item.name}${spec} — Qty: ${qty}`;
    })
    .join("\n");

  return template
    .replace("{supplier}", supplierName)
    .replace("{rfqCode}", rfqCode)
    .replace("{category}", category.replace(/_/g, " "))
    .replace("{items}", itemLines);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Load RFQ + items
  const { data: rfq } = await supabase.from("rfqs").select("rfq_code").eq("id", rfqId).single();
  const { data: items } = await supabase
    .from("rfq_items")
    .select("id, name, qty, unit, spec, category")
    .eq("rfq_id", rfqId)
    .eq("user_id", user.id);

  if (!rfq || !items) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  // Load message template from settings
  const { data: settingRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .eq("key", "message_template");
  const messageTemplate = settingRows?.[0]?.value ?? DEFAULT_TEMPLATE;

  // Load all user suppliers
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, whatsapp_number, email, categories")
    .eq("user_id", user.id)
    .eq("active", true);

  // Group items by category
  const byCategory: Record<string, typeof items> = {};
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  // Delete existing outgoing RFQs for this parent (re-split)
  const { error: clearError } = await supabase.from("outgoing_rfqs").delete().eq("rfq_id", rfqId).eq("user_id", user.id);
  if (clearError) {
    console.error("[rfqs/split] clearing old outgoing rfqs failed", clearError);
    return NextResponse.json({ error: `Could not clear previous split: ${clearError.message}` }, { status: 500 });
  }

  const outgoingRows: unknown[] = [];
  let seq = 1;

  for (const [category, catItems] of Object.entries(byCategory)) {
    // Find suppliers for this category
    const matched = (suppliers ?? []).filter((s) =>
      s.categories?.includes(category)
    );

    if (matched.length === 0) {
      // No supplier — still create a row so staff can see the gap
      const childCode = `${rfq.rfq_code}-${category.slice(0, 3)}-${String(seq++).padStart(2, "0")}`;
      const { data: outgoing, error: outgoingError } = await supabase
        .from("outgoing_rfqs")
        .insert({
          rfq_id: rfqId, user_id: user.id, supplier_id: null,
          child_code: childCode, category,
          message_body: null, channel: "whatsapp", status: "no_supplier",
        })
        .select("*, suppliers(name, whatsapp_number, email)")
        .single();
      if (outgoingError || !outgoing) {
        console.error("[rfqs/split] outgoing_rfqs insert failed (no supplier)", { category, error: outgoingError });
      } else {
        outgoingRows.push(outgoing);
        const itemRows = catItems.map((i) => ({
          outgoing_rfq_id: outgoing.id, item_id: i.id, user_id: user.id,
        }));
        const { error: itemsError } = await supabase.from("outgoing_rfq_items").insert(itemRows);
        if (itemsError) console.error("[rfqs/split] outgoing_rfq_items insert failed", { category, error: itemsError });
      }
      continue;
    }

    // One outgoing RFQ per matched supplier
    for (const supplier of matched) {
      const childCode = `${rfq.rfq_code}-${category.slice(0, 3)}-${String(seq++).padStart(2, "0")}`;
      const message = buildMessage(messageTemplate, supplier.name, rfq.rfq_code, category, catItems);

      const { data: outgoing, error: outgoingError } = await supabase
        .from("outgoing_rfqs")
        .insert({
          rfq_id: rfqId, user_id: user.id, supplier_id: supplier.id,
          child_code: childCode, category, message_body: message,
          channel: supplier.whatsapp_number ? "whatsapp" : "email",
          status: "draft",
        })
        .select("*, suppliers(name, whatsapp_number, email)")
        .single();

      if (outgoingError || !outgoing) {
        console.error("[rfqs/split] outgoing_rfqs insert failed", { category, supplierId: supplier.id, error: outgoingError });
      } else {
        outgoingRows.push(outgoing);
        const itemRows = catItems.map((i) => ({
          outgoing_rfq_id: outgoing.id, item_id: i.id, user_id: user.id,
        }));
        const { error: itemsError } = await supabase.from("outgoing_rfq_items").insert(itemRows);
        if (itemsError) console.error("[rfqs/split] outgoing_rfq_items insert failed", { category, supplierId: supplier.id, error: itemsError });
      }
    }
  }

  // Mark parent RFQ as approved
  const { error: statusError } = await supabase.from("rfqs").update({ status: "approved" }).eq("id", rfqId);
  if (statusError) console.error("[rfqs/split] status update failed", statusError);

  return NextResponse.json({ outgoing: outgoingRows });
}
