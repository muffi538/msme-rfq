import { NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { trashMessage } from "@/lib/email/gmail";
import { checkRateLimit } from "@/lib/rateLimit";

// Deletes a pending RFQ's source email from Gmail (moves it to Trash) and,
// only once that succeeds, removes the RFQ record itself. If the Gmail
// side fails, the RFQ is left untouched so the card stays in the list and
// the user can retry — never delete our own record for an email we
// couldn't actually remove.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const allowed = await checkRateLimit(supabase, user.id, "rfq-delete-email", 300, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429 });
  }

  const { data: rfq } = await supabase.from("rfqs").select("id, file_name").eq("id", id).maybeSingle();
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  // Only email-derived RFQs carry a Gmail message id in file_name
  // ("msgid:<id>" or "msgid:<id>|<attachment>") — anything else (manual
  // uploads) has nothing to delete from Gmail, just remove the record.
  const messageId = rfq.file_name?.match(/^msgid:([^|]+)/)?.[1];

  if (messageId) {
    const { data: tokenRows } = await supabase
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "gmail_refresh_token")
      .order("created_at", { ascending: false })
      .limit(1);
    const refreshToken = tokenRows?.[0]?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: "Gmail not connected. Please connect your Gmail account first." }, { status: 400 });
    }

    try {
      await trashMessage(messageId, refreshToken);
    } catch (err: unknown) {
      logError("[rfqs/delete-email] Gmail trash failed", { messageId, error: err });
      return NextResponse.json(
        { error: err instanceof Error ? `Could not delete from Gmail: ${err.message}` : "Could not delete this email from Gmail." },
        { status: 502 }
      );
    }
  }

  const { error: deleteError } = await supabase.from("rfqs").delete().eq("id", id);
  if (deleteError) {
    logError("[rfqs/delete-email] rfqs delete failed", deleteError);
    return NextResponse.json({ error: `Email was removed from Gmail, but couldn't remove it here: ${deleteError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
