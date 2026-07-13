import { createClient } from "@/lib/supabase/client";

// Wraps fetch() for calls to this app's own /api/* routes. If the first
// attempt comes back 401 with error === "Unauthorised" — this app's own
// login-session check failing inside a route handler, never a Gmail-related
// error (those always come back with a descriptive JSON error, not a bare
// 401) — this tries an explicit client-side session refresh and retries
// the request once before giving up.
//
// Why this exists: the app's route handlers rely on the session cookie
// being fresh, but middleware (the usual place Supabase's SSR client
// silently refreshes an expiring cookie) deliberately excludes /api/* here
// to avoid doubling auth latency on every request. The browser's Supabase
// client normally refreshes proactively in the background on its own timer,
// but that timer can lag behind a real expiry after the tab sits
// backgrounded for a while (browsers throttle JS timers in inactive tabs) —
// so the very next request after resuming activity can catch a stale
// cookie. This recovers from exactly that instead of surfacing a scary
// "Unauthorised" for something the app can fix itself; a session that's
// truly dead (refresh also fails) still surfaces normally.
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401) return first;

  let body: { error?: string } = {};
  try { body = await first.clone().json(); } catch { /* not JSON — not our session check, nothing to recover from */ }
  if (body.error !== "Unauthorised") return first;

  const supabase = createClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) return first; // refresh itself failed — genuinely signed out, let the caller handle it

  return fetch(input, init);
}
