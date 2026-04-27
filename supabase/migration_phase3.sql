-- =============================================
-- RFQ Flow — Phase 3 Database Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- Outgoing RFQs (one per supplier per parent RFQ)
CREATE TABLE IF NOT EXISTS outgoing_rfqs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id       UUID REFERENCES rfqs(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  supplier_id  UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  child_code   TEXT NOT NULL,
  category     TEXT NOT NULL,
  message_body TEXT,
  channel      TEXT DEFAULT 'whatsapp',   -- 'whatsapp' | 'email'
  status       TEXT DEFAULT 'draft',      -- draft | approved | sent | failed | no_supplier
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Which items belong to which outgoing RFQ
CREATE TABLE IF NOT EXISTS outgoing_rfq_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_rfq_id UUID REFERENCES outgoing_rfqs(id) ON DELETE CASCADE NOT NULL,
  item_id         UUID REFERENCES rfq_items(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
);

-- RLS
ALTER TABLE outgoing_rfqs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE outgoing_rfq_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own outgoing rfqs"       ON outgoing_rfqs      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own outgoing rfq items"  ON outgoing_rfq_items FOR ALL USING (auth.uid() = user_id);
