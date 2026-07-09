-- =============================================
-- Background jobs — lets long-running operations (starting with email
-- fetch) run after the request returns, instead of blocking the UI for
-- the full duration. The client polls this table for status/progress.
-- =============================================

CREATE TABLE IF NOT EXISTS jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type       TEXT NOT NULL,               -- e.g. 'email_fetch'
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  progress   JSONB,                       -- arbitrary in-flight progress, e.g. {"processed": 5, "total": 20}
  result     JSONB,                       -- final payload once status = 'done'
  error      TEXT,                        -- error message once status = 'failed'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_user_id_created_at_idx ON jobs (user_id, created_at DESC);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own jobs" ON jobs;
CREATE POLICY "Users see own jobs"
  ON jobs FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- Old jobs accumulate forever otherwise. Cheap to run manually now and then;
-- not wired to a schedule (same pattern as cleanup_rate_limits()).
CREATE OR REPLACE FUNCTION cleanup_old_jobs() RETURNS void AS $$
  DELETE FROM jobs WHERE created_at < now() - interval '7 days';
$$ LANGUAGE sql SECURITY DEFINER;
