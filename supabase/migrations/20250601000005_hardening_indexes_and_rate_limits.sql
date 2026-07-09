-- =============================================
-- Production hardening — indexes, missing constraint, rate limiting
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- Performance indexes — every table filters by user_id (both app queries and
-- every RLS policy), and none of them had an index on it before this. Safe
-- to run any time; IF NOT EXISTS makes it idempotent.

CREATE INDEX IF NOT EXISTS rfqs_user_id_created_at_idx
  ON rfqs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rfqs_file_name_idx
  ON rfqs (file_name);

CREATE INDEX IF NOT EXISTS rfq_items_rfq_id_idx
  ON rfq_items (rfq_id);

CREATE INDEX IF NOT EXISTS rfq_items_user_id_idx
  ON rfq_items (user_id);

CREATE INDEX IF NOT EXISTS suppliers_user_id_idx
  ON suppliers (user_id);

CREATE INDEX IF NOT EXISTS outgoing_rfqs_rfq_id_idx
  ON outgoing_rfqs (rfq_id);

CREATE INDEX IF NOT EXISTS outgoing_rfqs_user_id_idx
  ON outgoing_rfqs (user_id);

CREATE INDEX IF NOT EXISTS outgoing_rfq_items_outgoing_rfq_id_idx
  ON outgoing_rfq_items (outgoing_rfq_id);

CREATE INDEX IF NOT EXISTS outgoing_rfq_items_user_id_idx
  ON outgoing_rfq_items (user_id);

-- Also fixes the Tally import bug found this session (upsert onConflict
-- "user_id,name" had no matching constraint, so it silently failed every
-- time). ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so guard it manually.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_user_id_name_key'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_user_id_name_key UNIQUE (user_id, name);
  END IF;
END $$;


-- =============================================
-- Rate limiting — lightweight, Postgres-only (no Redis/Upstash needed for a
-- single customer). One atomic function does check-and-increment in a
-- single statement so it's safe under concurrent requests.
-- =============================================

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id      UUID NOT NULL,
  bucket       TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, bucket, window_start)
);

-- No app code queries this table directly (only the SECURITY DEFINER
-- function below does, which bypasses RLS) — enabling RLS with zero
-- policies just means "deny all direct access" as a safety net.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_bucket TEXT,
  p_window_seconds INT,
  p_max_requests INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO rate_limits (user_id, bucket, window_start, count)
  VALUES (p_user_id, p_bucket, v_window_start, 1)
  ON CONFLICT (user_id, bucket, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_requests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION check_rate_limit FROM public, anon;
GRANT EXECUTE ON FUNCTION check_rate_limit TO authenticated;

-- Old rows accumulate forever otherwise — clean up anything more than a day
-- stale. Cheap to run manually now and then; not wired to a schedule.
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
  DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
$$ LANGUAGE sql SECURITY DEFINER;
