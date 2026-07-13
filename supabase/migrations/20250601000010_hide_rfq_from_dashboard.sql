-- =============================================
-- "Delete Email" on a pending RFQ card must NEVER touch Gmail — it only
-- hides the RFQ from this app. The row (and its dedup marker in
-- file_name, which future email syncs check against) stays intact so the
-- same message is never re-imported; it just no longer shows up here.
-- Run in: Supabase Dashboard → SQL Editor
-- =============================================

ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS hidden_from_dashboard BOOLEAN DEFAULT false;
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS hidden_at             TIMESTAMPTZ;
