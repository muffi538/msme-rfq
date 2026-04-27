-- =============================================
-- RFQ Flow — Phase 2 Database Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- RFQs table (one row per uploaded RFQ)
CREATE TABLE IF NOT EXISTS rfqs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  rfq_code      TEXT NOT NULL,
  buyer_name    TEXT,
  buyer_email   TEXT,
  file_name     TEXT,
  file_url      TEXT,
  file_type     TEXT,                        -- 'pdf' | 'excel' | 'image'
  raw_text      TEXT,                        -- extracted raw text
  status        TEXT DEFAULT 'pending',      -- pending | processing | processed | approved | sent
  priority      TEXT DEFAULT 'normal',       -- normal | urgent
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Items table (one row per line item inside an RFQ)
CREATE TABLE IF NOT EXISTS rfq_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id              UUID REFERENCES rfqs(id) ON DELETE CASCADE NOT NULL,
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  line_number         INT,
  raw_text            TEXT,
  name                TEXT NOT NULL,
  qty                 NUMERIC,
  unit                TEXT,
  brand               TEXT,
  spec                TEXT,
  notes               TEXT,
  category            TEXT,                  -- one of the 12 fixed categories
  category_source     TEXT,                  -- 'keyword' | 'llm' | 'cache'
  category_confidence NUMERIC,
  flagged             BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Suppliers table (manually added by the user)
CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name             TEXT NOT NULL,
  contact_person   TEXT,
  email            TEXT,
  whatsapp_number  TEXT,
  categories       TEXT[] DEFAULT '{}',      -- array of category names
  active           BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- Row Level Security — each user sees only their own data
-- =============================================

ALTER TABLE rfqs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own rfqs"      ON rfqs       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own items"     ON rfq_items  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own suppliers" ON suppliers  FOR ALL USING (auth.uid() = user_id);

-- =============================================
-- Storage bucket for RFQ file uploads
-- =============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('rfq-files', 'rfq-files', false)
ON CONFLICT DO NOTHING;

CREATE POLICY "Users upload own files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'rfq-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own files"
ON storage.objects FOR SELECT
USING (bucket_id = 'rfq-files' AND auth.uid()::text = (storage.foldername(name))[1]);
