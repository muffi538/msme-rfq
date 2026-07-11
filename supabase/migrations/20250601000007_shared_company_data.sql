-- =============================================
-- Shared company data — this app is used by multiple people at ONE company,
-- not multiple separate tenants. Business records (RFQs, suppliers, outgoing
-- RFQs, buyer reply logs) were previously siloed per auth user_id via RLS,
-- so a second login could never see records created by the first. This
-- migration makes those tables shared across every signed-in user while
-- keeping genuinely personal data (Gmail connection, per-user job status)
-- private. Run in: Supabase Dashboard → SQL Editor
-- =============================================

-- =============================================
-- 1. updated_at + auto-update trigger, for optimistic-concurrency checks
--    ("warn if the record changed while you were editing").
-- =============================================

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE suppliers     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE rfq_items     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE outgoing_rfqs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS set_updated_at ON rfqs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON suppliers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON rfq_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rfq_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON outgoing_rfqs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON outgoing_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================
-- 2. Suppliers become shared, so "unique per user" no longer makes sense —
--    it must become "unique per company". First merge any exact duplicate
--    names that already exist across different users (keep the oldest row;
--    outgoing_rfqs.supplier_id is ON DELETE SET NULL, so already-sent child
--    RFQs just lose the supplier link, no rows are lost).
-- =============================================

DELETE FROM suppliers a
USING suppliers b
WHERE a.id <> b.id
  AND lower(a.name) = lower(b.name)
  AND (a.created_at, a.id) > (b.created_at, b.id);

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_user_id_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_name_key'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_name_key UNIQUE (name);
  END IF;
END $$;

-- =============================================
-- 3. Relax RLS on shared business tables — any signed-in user can read and
--    write. Personal tables (user_settings, jobs, profiles) are untouched
--    and stay scoped to auth.uid().
-- =============================================

DROP POLICY IF EXISTS "Users see own rfqs" ON rfqs;
CREATE POLICY "Company users share rfqs"
  ON rfqs FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users see own items" ON rfq_items;
CREATE POLICY "Company users share rfq items"
  ON rfq_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users see own suppliers" ON suppliers;
CREATE POLICY "Company users share suppliers"
  ON suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users see own outgoing rfqs" ON outgoing_rfqs;
CREATE POLICY "Company users share outgoing rfqs"
  ON outgoing_rfqs FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users see own outgoing rfq items" ON outgoing_rfq_items;
CREATE POLICY "Company users share outgoing rfq items"
  ON outgoing_rfq_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users see own buyer reply logs" ON buyer_reply_logs;
CREATE POLICY "Company users share buyer reply logs"
  ON buyer_reply_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- 4. Company-wide settings (company name, message templates, custom supplier
--    categories) — these were being stored per-user in user_settings, so a
--    second user editing "Settings" never saw what the first user had saved.
--    New shared table, one row per key, plain "last write wins" — matches
--    the rest of the app's concurrency model.
-- =============================================

CREATE TABLE IF NOT EXISTS company_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS set_updated_at ON company_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users share company settings" ON company_settings;
CREATE POLICY "Company users share company settings"
  ON company_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Backfill from whichever user_settings rows already exist for these keys —
-- take the most recently updated one per key as the starting shared value.
INSERT INTO company_settings (key, value, updated_at)
SELECT DISTINCT ON (key) key, value, updated_at
FROM user_settings
WHERE key IN ('company_name', 'message_template', 'buyer_reply_template', 'custom_categories')
ORDER BY key, updated_at DESC
ON CONFLICT (key) DO NOTHING;
