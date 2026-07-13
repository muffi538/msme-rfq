-- Robust Gmail dedup: track the actual Gmail message/thread id instead of
-- relying on a string-prefix match against file_name. The unique index
-- (partial, ignores NULLs for non-Gmail-sourced rows) means the DB itself
-- rejects a duplicate insert if the cron sync and a manual "Fetch Now" ever
-- race on the same message.
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS rfqs_gmail_message_id_uidx ON rfqs (gmail_message_id) WHERE gmail_message_id IS NOT NULL;
