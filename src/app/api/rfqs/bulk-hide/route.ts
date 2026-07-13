import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";

// Bulk version of /api/rfqs/[id]/hide — same "dashboard-only, never touch
// Gmail" semantics, but as one batch UPDATE instead of N requests. Falls
// back to per-row updates only if the batch statement itself fails, so a
// partial-failure summary can still be reported accurately.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "No RFQ ids provided" }, { status: 400 });

  const hiddenAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("rfqs")
    .update({ hidden_from_dashboard: true, hidden_at: hiddenAt })
    .in("id", ids)
    .select("id");

  if (!error) {
    const succeeded = (data ?? []).map((r) => r.id as string);
    const failed = ids.filter((id) => !succeeded.includes(id));
    return NextResponse.json({ succeeded, failed });
  }

  // Batch statement itself failed — fall back to one-by-one so we can still
  // report which specific RFQs succeeded vs failed instead of losing that
  // information entirely.
  logError("[rfqs/bulk-hide] batch update failed, falling back to per-row", error);
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    const { error: rowError } = await supabase
      .from("rfqs")
      .update({ hidden_from_dashboard: true, hidden_at: hiddenAt })
      .eq("id", id);
    if (rowError) failed.push(id); else succeeded.push(id);
  }

  return NextResponse.json({ succeeded, failed });
}
