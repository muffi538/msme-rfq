import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { logError } from "@/lib/logError";
import { syncGmailForUser } from "@/lib/email/sync";
import { mapWithConcurrency } from "@/lib/concurrency";

/**
 * Automatic Gmail sync — runs every 2 minutes via Vercel cron (see
 * vercel.json). For every user with Gmail connected, pulls only
 * new/unprocessed messages (via History API, falling back to a bounded
 * unread scan when there's no checkpoint yet or it's expired) and inserts
 * them as pending RFQs. One user's failure never blocks the others.
 */

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Bounded parallelism across users — keeps a large user base from serializing
// through 2-minute cron windows one account at a time.
const USER_CONCURRENCY = 5;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: tokenRows } = await admin
    .from("user_settings")
    .select("user_id, value")
    .eq("key", "gmail_refresh_token");

  if (!tokenRows || tokenRows.length === 0) {
    return NextResponse.json({ ok: true, users: 0, created: 0 });
  }

  let created = 0;
  let deduped = 0;
  let failed = 0;
  const errors: string[] = [];

  await mapWithConcurrency(tokenRows, USER_CONCURRENCY, async (row) => {
    try {
      const result = await syncGmailForUser(admin, row.user_id, row.value);
      created += result.created;
      deduped += result.deduped;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[cron/gmail-sync] failed for user ${row.user_id}`, err);
      errors.push(`${row.user_id}: ${msg}`);
    }
  });

  return NextResponse.json({ ok: true, users: tokenRows.length, created, deduped, failed, errors });
}
