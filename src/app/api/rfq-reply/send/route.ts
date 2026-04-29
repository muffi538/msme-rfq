import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/gmail";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { to, subject, body } = await request.json() as {
    to: string;
    subject: string;
    body: string;
  };

  if (!to || !subject || !body) {
    return NextResponse.json({ error: "to, subject and body are required" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "Invalid recipient email address" }, { status: 400 });
  }

  const { data: settingRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .eq("key", "company_name");
  const companyName = settingRows?.[0]?.value ?? "RFQ Flow";

  try {
    await sendEmail({ to, subject, body, fromName: companyName });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
