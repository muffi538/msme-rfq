-- =============================================
-- Revert "shared company data" (20250601000007) — this app is used by
-- separate MSME client accounts, not one company's internal team, so
-- USING (true) on rfqs/rfq_items/etc let ANY signed-in user read and write
-- every other account's business data. Restores the strict per-user RLS
-- from 20250601000004 (auth.uid() = user_id OR is_admin(), admin access
-- preserved for support) on every table the shared-data migration touched,
-- including rfq_files/rfq_item_images which were created already-shared
-- and never had a per-user policy at all. Run in: Supabase Dashboard → SQL
-- Editor
-- =============================================

-- =============================================
-- 1. rfqs / rfq_items / suppliers / outgoing_rfqs / outgoing_rfq_items /
--    buyer_reply_logs — back to strict per-user (+ admin bypass).
-- =============================================

DROP POLICY IF EXISTS "Company users share rfqs" ON rfqs;
CREATE POLICY "Users see own rfqs"
  ON rfqs FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Company users share rfq items" ON rfq_items;
CREATE POLICY "Users see own items"
  ON rfq_items FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Company users share suppliers" ON suppliers;
CREATE POLICY "Users see own suppliers"
  ON suppliers FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Company users share outgoing rfqs" ON outgoing_rfqs;
CREATE POLICY "Users see own outgoing rfqs"
  ON outgoing_rfqs FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Company users share outgoing rfq items" ON outgoing_rfq_items;
CREATE POLICY "Users see own outgoing rfq items"
  ON outgoing_rfq_items FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Company users share buyer reply logs" ON buyer_reply_logs;
CREATE POLICY "Users see own buyer reply logs"
  ON buyer_reply_logs FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- =============================================
-- 2. rfq_files / rfq_item_images — created already-shared in
--    20250601000008, so this is the first time they get a per-user policy.
-- =============================================

DROP POLICY IF EXISTS "Company users share rfq files" ON rfq_files;
CREATE POLICY "Users see own rfq files"
  ON rfq_files FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Company users share rfq item images" ON rfq_item_images;
CREATE POLICY "Users see own rfq item images"
  ON rfq_item_images FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- =============================================
-- 3. suppliers — revert the company-wide unique constraint back to
--    per-user. (The one-time cross-user name merge from the shared-data
--    migration is not undone — those were literal duplicate names being
--    collapsed into one row, harmless to leave merged.)
-- =============================================

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_user_id_name_key'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_user_id_name_key UNIQUE (user_id, name);
  END IF;
END $$;

-- =============================================
-- 4. company_settings — this table only exists because of the shared-data
--    migration; the app no longer writes to it (see the accompanying code
--    change reverting /api/settings to per-user user_settings rows).
--    Lock it down to admin-only instead of dropping it outright, so no
--    regular user can read/write it even if some code path still
--    references it.
-- =============================================

DROP POLICY IF EXISTS "Company users share company settings" ON company_settings;
CREATE POLICY "Admins only on legacy company settings"
  ON company_settings FOR ALL
  USING (public.is_admin());

-- =============================================
-- 5. Storage — rfq-files SELECT policy back to "own folder only".
--    INSERT was already correctly per-user-folder-scoped throughout (the
--    shared-data migration never touched it).
-- =============================================

DROP POLICY IF EXISTS "Company users read rfq files" ON storage.objects;
CREATE POLICY "Users read own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rfq-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =============================================
-- 6. Gmail message dedup must be scoped per user too — a company-wide
--    unique index on gmail_message_id would let one user's sync silently
--    "dedupe away" (skip importing) a message that only collides in ID
--    with something a totally different, unrelated user already imported.
-- =============================================

DROP INDEX IF EXISTS rfqs_gmail_message_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS rfqs_user_gmail_message_id_uidx
  ON rfqs (user_id, gmail_message_id) WHERE gmail_message_id IS NOT NULL;
