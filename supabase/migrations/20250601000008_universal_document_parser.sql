-- =============================================
-- Universal document parser — upload upgrades RFQ upload to accept multiple
-- files of mixed formats (PDF/Excel/CSV/DOCX/TXT/images) merged into ONE
-- RFQ, with per-item images and richer extracted fields. Purely additive:
-- no existing column is renamed or dropped, the single-file/email-derived
-- pipeline (rfqs.raw_text/file_url/file_type, rfq_items core columns) is
-- untouched. Run in: Supabase Dashboard → SQL Editor
-- =============================================

-- One row per source file that contributed to an RFQ (an RFQ can now be
-- built from several files at once). rfqs.file_name/file_url/file_type/
-- raw_text stay populated too (first file, for backward compatibility with
-- anything that still reads those single-file columns directly).
CREATE TABLE IF NOT EXISTS rfq_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id      UUID REFERENCES rfqs(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  file_name   TEXT NOT NULL,
  file_url    TEXT,                 -- storage path in the rfq-files bucket
  file_type   TEXT NOT NULL,        -- pdf | excel | csv | docx | text | image
  raw_text    TEXT,                 -- extracted text (OCR'd text for images)
  status      TEXT DEFAULT 'parsed', -- parsed | failed
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rfq_files_rfq_id_idx ON rfq_files (rfq_id);

ALTER TABLE rfq_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Company users share rfq files" ON rfq_files;
CREATE POLICY "Company users share rfq files"
  ON rfq_files FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Product images extracted from an upload. item_id is nullable — an image
-- that couldn't be confidently matched to a line item stays unassigned and
-- shows up in the "Unassigned Images" section instead of being dropped.
CREATE TABLE IF NOT EXISTS rfq_item_images (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id             UUID REFERENCES rfqs(id) ON DELETE CASCADE NOT NULL,
  item_id            UUID REFERENCES rfq_items(id) ON DELETE SET NULL,
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  file_url           TEXT NOT NULL,  -- storage path in the rfq-files bucket
  source_file_name   TEXT,
  match_confidence   NUMERIC,        -- how sure the auto-matcher was (null = unassigned)
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rfq_item_images_rfq_id_idx  ON rfq_item_images (rfq_id);
CREATE INDEX IF NOT EXISTS rfq_item_images_item_id_idx ON rfq_item_images (item_id);

ALTER TABLE rfq_item_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Company users share rfq item images" ON rfq_item_images;
CREATE POLICY "Company users share rfq item images"
  ON rfq_item_images FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- RFQ-level fields extracted from document content (distinct from rfq_code,
-- which is OUR generated sequential code — source_rfq_number is whatever
-- number, if any, was printed on the buyer's own document).
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS source_rfq_number TEXT;
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS source_date        TEXT;
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS warnings            TEXT[] DEFAULT '{}';

-- Richer per-item fields.
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS part_number       TEXT;
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS delivery_details  TEXT;
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS confidence        NUMERIC;      -- overall extraction confidence (distinct from category_confidence)
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS warnings          TEXT[] DEFAULT '{}';
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS merged_from_count INT DEFAULT 1; -- >1 = deduped from repeated mentions across source files

-- =============================================
-- 5. The rfq-files storage bucket's SELECT policy was still scoped to
--    "only the uploader's own folder" (it predates the shared-company-data
--    migration, which only touched table RLS, not storage). Every user
--    needs to be able to view thumbnails/files another user uploaded, now
--    that RFQs themselves are shared — widen read access the same way.
--    Upload (INSERT) stays scoped to the uploader's own folder; nobody
--    needs to write into someone else's path.
-- =============================================

DROP POLICY IF EXISTS "Users read own files" ON storage.objects;
CREATE POLICY "Company users read rfq files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rfq-files');
