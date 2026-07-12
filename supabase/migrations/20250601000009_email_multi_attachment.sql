-- =============================================
-- Fix: Gmail RFQ import only ever captured text from the FIRST supported
-- attachment per email and silently dropped the rest. The fetch job now
-- stores every attachment as its own rfq_files row (added in the previous
-- migration); the "Process it" step merges all of them. This migration
-- just adds the one new column needed to show which source file each
-- merged item came from. Run in: Supabase Dashboard → SQL Editor
-- =============================================

ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS source_files TEXT[] DEFAULT '{}';
