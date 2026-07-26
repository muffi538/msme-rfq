-- =============================================
-- Full supplier profile — the suppliers table only had name/contact_person/
-- email/whatsapp_number/categories/brands/notes; adds the remaining fields
-- a real supplier record needs (company name distinct from the supplier's
-- own name, a separate general phone number, a persisted wa.me chat link
-- alongside the raw number, postal address split into address/city/state/
-- country, and GST number). All nullable/additive — existing rows and
-- every existing reader/writer are unaffected.
-- =============================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company_name  TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone_number  TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp_link TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address       TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city          TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS state         TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country       TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_number    TEXT;

-- Supports the Excel/Tally import's duplicate lookup (case-insensitive name
-- match, plus whatsapp/email match) without a full-table scan per row —
-- that lookup is done once per import batch, not per row, but still needs
-- to be fast for accounts with a large existing supplier list. The existing
-- suppliers_user_id_name_key UNIQUE(user_id, name) constraint stays as the
-- hard, case-sensitive backstop against exact duplicate inserts; these are
-- plain (non-unique) indexes purely for the duplicate-detection query.
CREATE INDEX IF NOT EXISTS suppliers_user_lower_name_idx
  ON suppliers (user_id, lower(name));

CREATE INDEX IF NOT EXISTS suppliers_user_whatsapp_idx
  ON suppliers (user_id, whatsapp_number) WHERE whatsapp_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS suppliers_user_lower_email_idx
  ON suppliers (user_id, lower(email)) WHERE email IS NOT NULL;
