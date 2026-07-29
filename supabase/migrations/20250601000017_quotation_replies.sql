-- =============================================
-- Quotation replies — "Import Existing RFQ" in the RFQ Reply page.
--
-- Root gap this closes: RFQ Reply (buyer_reply_logs) has NEVER been linked
-- to an rfqs row — it only stores a JSONB blob keyed by buyer_email, and
-- every screen that shows "quote received" state (RfqDetailClient,
-- RfqsClient, the workspace page) has to fuzzy-match by lowercased email
-- string (see matchBuyerReplyLog in src/lib/rfq-lifecycle.ts). Two RFQs
-- from the same buyer email collide onto the same "quote received" log.
--
-- quotation_replies is a real, rfq_id-linked quotation record (one row per
-- reply sent/drafted for an RFQ; rfq_id nullable so ad-hoc replies with no
-- matching RFQ in the system are still allowed, same as today).
-- quotation_reply_items is its line items, one row per rfq_items row when
-- built via "Import Existing RFQ" (item_id set) or a freeform row when
-- built via the external Screenshot/Upload/Paste flow (item_id null).
-- Preserves item order via line_number, supports 100+ items, partial
-- pricing (unit_price nullable), and draft/sent status so a large
-- quotation can be saved and resumed.
-- =============================================

CREATE TABLE IF NOT EXISTS quotation_replies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  rfq_id              UUID REFERENCES rfqs(id) ON DELETE SET NULL,
  source              TEXT NOT NULL DEFAULT 'external' CHECK (source IN ('external', 'imported')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  supplier_name       TEXT,
  buyer_email         TEXT NOT NULL,
  buyer_name          TEXT,
  email_subject       TEXT,
  email_body          TEXT,
  currency            TEXT NOT NULL DEFAULT 'INR',
  tax_percent         NUMERIC NOT NULL DEFAULT 0,
  discount_percent    NUMERIC NOT NULL DEFAULT 0,
  subtotal            NUMERIC NOT NULL DEFAULT 0,
  tax_amount          NUMERIC NOT NULL DEFAULT 0,
  grand_total         NUMERIC NOT NULL DEFAULT 0,
  validity_days       INT,
  payment_terms       TEXT,
  gmail_message_id    TEXT,
  gmail_thread_id     TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one DRAFT per RFQ per user — "resume the draft" (opening Import
-- Existing RFQ for an RFQ that already has one in progress) needs a single
-- unambiguous row to load, not a pick-one-of-many. Sent replies are
-- unrestricted (partial re-quotes / revisions can each be sent separately).
CREATE UNIQUE INDEX IF NOT EXISTS quotation_replies_one_draft_per_rfq
  ON quotation_replies (user_id, rfq_id)
  WHERE status = 'draft' AND rfq_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quotation_replies_user_rfq_idx
  ON quotation_replies (user_id, rfq_id);

CREATE INDEX IF NOT EXISTS quotation_replies_user_email_idx
  ON quotation_replies (user_id, lower(buyer_email), sent_at DESC);

ALTER TABLE quotation_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own quotation replies" ON quotation_replies;
CREATE POLICY "Users see own quotation replies"
  ON quotation_replies FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

CREATE TABLE IF NOT EXISTS quotation_reply_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_reply_id  UUID REFERENCES quotation_replies(id) ON DELETE CASCADE NOT NULL,
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  item_id             UUID REFERENCES rfq_items(id) ON DELETE SET NULL,
  line_number         INT NOT NULL,
  name                TEXT NOT NULL,
  qty                 NUMERIC,
  unit                TEXT,
  spec                TEXT,
  brand_offered       TEXT,
  unit_price          NUMERIC,
  discount_percent    NUMERIC NOT NULL DEFAULT 0,
  lead_time           TEXT,
  delivery_time       TEXT,
  remarks             TEXT,
  line_total          NUMERIC NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotation_reply_items_reply_idx
  ON quotation_reply_items (quotation_reply_id, line_number);

ALTER TABLE quotation_reply_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own quotation reply items" ON quotation_reply_items;
CREATE POLICY "Users see own quotation reply items"
  ON quotation_reply_items FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- New rfqs.status values for the fuller post-quotation lifecycle
-- (Quotation Sent → Under Evaluation → Purchase Order Received). No CHECK
-- constraint on rfqs.status pre-existed, so these are additive values used
-- by application code, not a schema-enforced enum change.
COMMENT ON COLUMN rfqs.status IS
  'pending | processing | processed | approved | sent | quotation_sent | under_evaluation | po_received | failed | cancelled | needs_processing';
