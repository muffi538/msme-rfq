import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { logError } from "@/lib/logError";

// Only these keys are settable via this endpoint — everything else (like
// gmail_refresh_token, rfq_labels) is personal, written by its own dedicated
// route, and must never be overwritable through a generic settings POST.
// These three ARE company-wide (shown to every user, used in outgoing
// messages/emails), so they live in company_settings, not user_settings.
const settingsSchema = z.object({
  message_template:     z.string().max(5000).optional(),
  buyer_reply_template: z.string().max(5000).optional(),
  company_name:         z.string().max(200).optional(),
}).strict();

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", ["message_template", "buyer_reply_template", "company_name"]);

  const settings: Record<string, string> = {};
  for (const row of data ?? []) settings[row.key] = row.value;
  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid settings: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, { status: 400 });
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    const { error } = await supabase
      .from("company_settings")
      .upsert({ key, value, updated_by: user.id }, { onConflict: "key" });
    if (error) {
      logError("[settings] upsert failed", { key, error });
      return NextResponse.json({ error: `Could not save "${key}": ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
