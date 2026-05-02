import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/gmail";

/**
 * Daily morning digest — runs at 09:00 IST (03:30 UTC) via Vercel cron.
 * For each user with Gmail connected, counts pending RFQs from the last
 * 24 hours and sends a short summary email from their own Gmail to
 * themselves. No third-party email service required.
 *
 * Schedule lives in vercel.json.
 */

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Auth: Vercel cron sends a Bearer token equal to CRON_SECRET.
  // Allow manual /api/cron/digest hits too if the secret matches.
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Use the service-role client so we can iterate across users
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Find every user with Gmail connected
  const { data: tokenRows } = await admin
    .from("user_settings")
    .select("user_id, value")
    .eq("key", "gmail_refresh_token");

  if (!tokenRows || tokenRows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: "no users with gmail connected" });
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let sent     = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const row of tokenRows) {
    try {
      // Look up this user's gmail address (recipient of the digest)
      const { data: emailRow } = await admin
        .from("user_settings")
        .select("value")
        .eq("user_id", row.user_id)
        .eq("key", "gmail_email")
        .single();
      const userEmail = emailRow?.value;
      if (!userEmail) { skipped++; continue; }

      // Pending = unprocessed RFQs from this user in last 24h
      const { count: pendingCount } = await admin
        .from("rfqs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", row.user_id)
        .in("status", ["pending", "needs_processing"])
        .gte("created_at", since24h);

      // Total pending (any age) — gives the user the full backlog picture
      const { count: totalPending } = await admin
        .from("rfqs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", row.user_id)
        .in("status", ["pending", "needs_processing"]);

      // Skip the user entirely if there's nothing to nag them about
      if ((totalPending ?? 0) === 0) { skipped++; continue; }

      // Get user's name for personalization
      const { data: { user: userInfo } } = await admin.auth.admin.getUserById(row.user_id);
      const firstName = (userInfo?.user_metadata?.full_name as string | undefined)?.split(" ")[0]
        ?? "there";

      const subject = (pendingCount ?? 0) > 0
        ? `📬 ${pendingCount} new RFQ${pendingCount === 1 ? "" : "s"} waiting`
        : `📬 ${totalPending} RFQ${totalPending === 1 ? "" : "s"} still pending`;

      const body = [
        `Good morning ${firstName},`,
        ``,
        (pendingCount ?? 0) > 0
          ? `You received ${pendingCount} new RFQ${pendingCount === 1 ? "" : "s"} in the last 24 hours.`
          : `You have ${totalPending} RFQ${totalPending === 1 ? "" : "s"} still waiting to be processed.`,
        ``,
        `Total pending in your inbox: ${totalPending}`,
        ``,
        `Open the dashboard to run AI and split them to suppliers:`,
        `https://msme-rfq.vercel.app/inbox`,
        ``,
        `— Procur.AI`,
        `(This digest is sent once a day at 9 AM. To stop receiving it, reply STOP.)`,
      ].join("\n");

      await sendEmail({
        to: userEmail,
        subject,
        body,
        fromName: "Procur.AI Digest",
        refreshToken: row.value,
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${row.user_id}: ${msg}`);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}
