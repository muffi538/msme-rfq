/**
 * k6 load test — realistic RFQ workflow: login, upload, process, list/search,
 * scan emails.
 *
 * DO NOT run this against production without explicit sign-off on timing and
 * cost. Every VU performs real OpenAI calls (upload + process, gpt-4o and
 * gpt-4o-mini) and real Gmail API calls (fetch), which cost real money and
 * count against real rate limits — this is not a free/synthetic-only test.
 * Prefer running it against a staging Supabase project + staging Vercel
 * deployment with a disposable test account and a low OpenAI spend cap.
 *
 * ── Auth caveat ──────────────────────────────────────────────────────────
 * This app's API routes authenticate via the `sb-<project-ref>-auth-token`
 * cookie set by @supabase/ssr, not an Authorization header. This script logs
 * in against Supabase's own Auth REST API to get a session, then serializes
 * it into that cookie using @supabase/ssr's documented format. That
 * serialization isn't a hard public contract — if it stops matching (e.g.
 * after a @supabase/ssr version bump), every authenticated request will
 * 401/redirect instead of failing loudly here. Before trusting results,
 * verify the cookie value against one captured from a real browser session
 * (DevTools → Application → Cookies) for the same project.
 *
 * Usage:
 *   k6 run \
 *     -e BASE_URL=https://staging.example.com \
 *     -e SUPABASE_URL=https://xxxx.supabase.co \
 *     -e SUPABASE_ANON_KEY=xxxx \
 *     -e TEST_EMAIL=loadtest@example.com \
 *     -e TEST_PASSWORD=xxxx \
 *     load-tests/rfq-flow.js
 */

import http from "k6/http";
import encoding from "k6/encoding";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE_URL           = __ENV.BASE_URL || "http://localhost:3000";
const SUPABASE_URL       = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY  = __ENV.SUPABASE_ANON_KEY;
const TEST_EMAIL         = __ENV.TEST_EMAIL;
const TEST_PASSWORD      = __ENV.TEST_PASSWORD;
const PROJECT_REF        = SUPABASE_URL ? SUPABASE_URL.replace("https://", "").split(".")[0] : "";

const uploadDuration  = new Trend("rfq_upload_duration");
const processDuration = new Trend("rfq_process_duration");
const fetchDuration   = new Trend("email_fetch_duration");
const listDuration    = new Trend("rfq_list_duration");
const errorRate       = new Rate("errors");

export const options = {
  scenarios: {
    realistic_usage: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 5 },   // ramp up — a handful of staff logging in
        { duration: "3m", target: 5 },   // steady state
        { duration: "1m", target: 0 },   // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000"],   // page/API calls should mostly be under 3s
    errors: ["rate<0.05"],               // less than 5% error rate
  },
};

function loginAndGetCookie() {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY } }
  );
  check(res, { "login succeeded": (r) => r.status === 200 });
  if (res.status !== 200) return null;

  const body = res.json();
  const sessionPayload = {
    access_token:  body.access_token,
    token_type:    body.token_type,
    expires_in:    body.expires_in,
    expires_at:    Math.floor(Date.now() / 1000) + body.expires_in,
    refresh_token: body.refresh_token,
    user:          body.user,
  };
  // @supabase/ssr's documented cookie format: "base64-" + base64(JSON string)
  const encoded = "base64-" + encoding.b64encode(JSON.stringify(sessionPayload));
  return `sb-${PROJECT_REF}-auth-token=${encoded}`;
}

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Set BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD env vars before running.");
  }
  const cookie = loginAndGetCookie();
  if (!cookie) throw new Error("Login failed — check TEST_EMAIL/TEST_PASSWORD and Supabase credentials.");
  return { cookie };
}

export default function (data) {
  const headers = { Cookie: data.cookie, "Content-Type": "application/json" };

  group("list RFQs (dashboard load)", () => {
    const res = http.get(`${BASE_URL}/rfqs`, { headers });
    listDuration.add(res.timings.duration);
    errorRate.add(res.status >= 400);
    check(res, { "rfqs list loaded": (r) => r.status === 200 });
  });

  sleep(1 + Math.random() * 2);

  group("scan emails (Gmail fetch)", () => {
    const res = http.post(`${BASE_URL}/api/email/fetch`, null, { headers });
    fetchDuration.add(res.timings.duration);
    errorRate.add(res.status >= 400 && res.status !== 429); // 429 = rate limit working as intended, not a bug
    check(res, { "email fetch responded": (r) => r.status === 200 || r.status === 429 });
  });

  sleep(1 + Math.random() * 2);

  group("upload RFQ (triggers OpenAI extraction)", () => {
    const samplePdf = open("./fixtures/sample-rfq.pdf", "b");
    const form = { file: http.file(samplePdf, "sample-rfq.pdf", "application/pdf"), priority: "normal" };
    const res = http.post(`${BASE_URL}/api/rfqs/upload`, form, { headers: { Cookie: data.cookie } });
    uploadDuration.add(res.timings.duration);
    errorRate.add(res.status >= 400 && res.status !== 429);
    check(res, { "upload responded": (r) => r.status === 200 || r.status === 429 });

    if (res.status === 200) {
      const rfqId = res.json("rfqId");
      sleep(1);
      group("re-process RFQ (AI recommendations)", () => {
        const procRes = http.post(`${BASE_URL}/api/rfqs/${rfqId}/process`, null, { headers });
        processDuration.add(procRes.timings.duration);
        errorRate.add(procRes.status >= 400 && procRes.status !== 429);
        check(procRes, { "process responded": (r) => r.status === 200 || r.status === 429 });
      });
    }
  });

  sleep(2 + Math.random() * 3);
}
