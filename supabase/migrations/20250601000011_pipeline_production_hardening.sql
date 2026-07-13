-- =============================================
-- Production hardening for the RFQ processing pipeline:
--  - jobs.rfq_id correlates a background job to the RFQ it's working on,
--    so the server can detect "this RFQ is already being processed"
--    (idempotency) and the client can re-attach to an in-flight job's
--    progress after a page refresh instead of losing track of it.
--  - rfqs.process_error stores the actual failure reason. Previously a
--    failed process run silently reverted status back to 'pending',
--    which looked identical to "never attempted" — no way to tell a
--    failed RFQ from a fresh one, and nothing to show a user who clicks
--    Retry. Failures now land in a real 'failed' status with a message.
-- Run in: Supabase Dashboard → SQL Editor
-- =============================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rfq_id UUID REFERENCES rfqs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS jobs_rfq_id_idx ON jobs (rfq_id, created_at DESC);

ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS process_error TEXT;
