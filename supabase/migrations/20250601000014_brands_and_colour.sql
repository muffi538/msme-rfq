-- =============================================
-- Two optional metadata fields, both additive/nullable so existing
-- suppliers and RFQ items keep working unchanged with no backfill needed.
-- =============================================

-- Supplier "brands" — mirrors the existing "categories" TEXT[] column
-- (same type, same default, same custom-value mechanism via user_settings).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS brands TEXT[] DEFAULT '{}';

-- Per-item "colour" — optional, defaults to NULL (unset), editable after
-- AI parsing. Existing rows simply read as NULL; nothing to backfill.
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS colour TEXT;

-- Unrelated to brands/colour, but reconciles real schema drift found while
-- touching this table: the app (RfqDetailClient.tsx, suppliers/page.tsx,
-- fetchRfqDetail.ts) has read/written suppliers.whatsapp_group_link since
-- an earlier change, but no migration file ever created it — it must have
-- been added directly against the database outside of tracked migrations.
-- IF NOT EXISTS makes this a no-op wherever it's already there.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp_group_link TEXT;
