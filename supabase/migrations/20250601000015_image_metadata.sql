-- =============================================
-- Manual metadata for RFQ item images (both assigned and unassigned) —
-- lets a user document an image the auto-matcher couldn't confidently
-- link to a line item (or add detail to one that IS linked) without
-- needing to touch the item itself. All optional/nullable, additive —
-- existing rows and callers are unaffected.
-- =============================================

ALTER TABLE rfq_item_images ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE rfq_item_images ADD COLUMN IF NOT EXISTS brand    TEXT;
ALTER TABLE rfq_item_images ADD COLUMN IF NOT EXISTS comment  TEXT;
