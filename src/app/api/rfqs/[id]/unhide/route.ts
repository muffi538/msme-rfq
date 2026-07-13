import { NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";

// Reverses /hide — used by the Undo toast and the "Restore Hidden Emails"
// settings page.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { error } = await supabase
    .from("rfqs")
    .update({ hidden_from_dashboard: false, hidden_at: null })
    .eq("id", id);

  if (error) {
    logError("[rfqs/unhide] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
