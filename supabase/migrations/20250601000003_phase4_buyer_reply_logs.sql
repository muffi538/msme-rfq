-- =============================================
-- Buyer reply logs (RFQ Reply → buyer notification)
-- Run in: Supabase Dashboard → SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS buyer_reply_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  buyer_email     TEXT NOT NULL,
  supplier_name   TEXT,
  quote_summary   JSONB,
  email_subject   TEXT NOT NULL,
  email_body      TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyer_reply_logs_user_email_idx
  ON buyer_reply_logs (user_id, lower(buyer_email), sent_at DESC);

ALTER TABLE buyer_reply_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own buyer reply logs" ON buyer_reply_logs;
CREATE POLICY "Users see own buyer reply logs"
  ON buyer_reply_logs FOR ALL USING (auth.uid() = user_id);
