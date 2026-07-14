import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/rfqs/[id]/item — update a single item's category and/or
// colour. Each field is only touched when present in the request body, so
// existing callers passing just { itemId, category } keep working exactly
// as before (no breaking change) while a new { itemId, colour } caller can
// update colour independently, in the same request, or both at once.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json() as { itemId?: string; category?: string; colour?: string | null };
  const { itemId, category, colour } = body;

  if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  if (category === undefined && colour === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (category !== undefined) { update.category = category; update.category_source = "manual"; update.flagged = false; }
  if (colour !== undefined) { update.colour = colour || null; }

  const { error } = await supabase
    .from("rfq_items")
    .update(update)
    .eq("id", itemId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
