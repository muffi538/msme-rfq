import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/rfqs/[id]/image — update a single image's manually-assigned
// category, brand, and/or comment. Mirrors item/route.ts's pattern: each
// field is only touched when present in the request body, so a caller can
// update one, two, or all three in the same request. Exists for images
// that couldn't be confidently auto-matched to a line item (or any image
// a user wants to annotate directly) — see the "Unassigned Images" section
// in RfqDetailClient.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json() as { imageId?: string; category?: string | null; brand?: string | null; comment?: string | null };
  const { imageId, category, brand, comment } = body;

  if (!imageId) return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  if (category === undefined && brand === undefined && comment === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (category !== undefined) update.category = category || null;
  if (brand !== undefined) update.brand = brand || null;
  if (comment !== undefined) update.comment = comment || null;

  const { error } = await supabase
    .from("rfq_item_images")
    .update(update)
    .eq("id", imageId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
