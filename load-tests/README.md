# Load testing

`rfq-flow.js` simulates a realistic staff workflow: log in, load the RFQ
list, scan for new emails, upload an RFQ (triggers OpenAI extraction), and
re-process it.

## Before running

- **Do not point this at production without explicit sign-off on timing and
  cost.** Every virtual user makes real OpenAI calls (upload + process) and
  real Gmail API calls (email fetch) — this is not a synthetic/free test.
  Run it against a staging Supabase project + staging Vercel deployment
  with a disposable test account, ideally with a low OpenAI spend cap set
  on that account.
- The auth approach (constructing the `sb-<project-ref>-auth-token` cookie
  from a Supabase Auth REST login) relies on `@supabase/ssr`'s cookie
  serialization format, which isn't a hard public contract. Before trusting
  results, verify the constructed cookie against one captured from a real
  browser session (DevTools → Application → Cookies) for the same project.
- `fixtures/sample-rfq.pdf` is reused from `pdf-parse`'s own bundled test
  fixtures (a real academic PDF, not synthetic RFQ content) — it exists
  purely to exercise the PDF parsing/upload pipeline under load, not to
  test extraction accuracy. Swap in a real anonymized RFQ PDF if you want
  the OpenAI extraction step to produce meaningful output during the test.

## Running

```bash
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e SUPABASE_URL=https://xxxx.supabase.co \
  -e SUPABASE_ANON_KEY=xxxx \
  -e TEST_EMAIL=loadtest@example.com \
  -e TEST_PASSWORD=xxxx \
  load-tests/rfq-flow.js
```

## What to look at afterward

- `http_req_duration` p95 — anything consistently over ~3s under the
  5-VU steady-state load in `options.scenarios` points at a real
  bottleneck, not just AI-call latency (which the thresholds already
  account for loosely).
- `errors` rate — should stay near zero; 429s from the rate limiter are
  excluded from this metric on purpose since they mean the limiter is
  doing its job, not that something is broken.
- Watch Vercel's function duration/memory dashboards and Supabase's
  connection-pool usage during the run — those will show the DB/serverless
  bottlenecks that the k6 output alone won't.
