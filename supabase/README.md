# Database migrations

This project had a real production outage this session because schema
changes lived as loose `.sql` files that were manually pasted into the
Supabase SQL Editor — with no record of which ones had actually been run.
The `user_settings` and `rfqs` tables didn't exist in production despite
their migration files sitting in the repo for weeks. This folder now uses
the Supabase CLI's migration system instead, so that can't happen silently
again.

## One-time setup (per machine)

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # find this in the Supabase dashboard URL
```

## Applying migrations to production

```bash
npx supabase db push
```

This applies every migration in `supabase/migrations/` that hasn't been
recorded as run yet, in filename order, and tracks what's been applied in
a `supabase_migrations.schema_migrations` table in your database — so
there's a single source of truth for "what's actually live," instead of
someone needing to remember which `.sql` files they've pasted into the
dashboard.

**Run this now** — `20250601000005_hardening_indexes_and_rate_limits.sql`
(indexes, the missing Tally-import constraint, and rate limiting) has not
been applied yet.

## Adding a new migration going forward

```bash
npx supabase migration new <short_description>
```

This creates a new timestamped file in `supabase/migrations/`. Write your
`CREATE TABLE` / `ALTER TABLE` / `CREATE POLICY` statements in it, then
`npx supabase db push` to apply it. Never hand-paste schema changes into
the SQL Editor going forward — if it's not a migration file, there's no
record it happened.

## One-time manual step: marking an account as admin

This is account-specific data, not schema, so it isn't in a migration.
Run once in the SQL Editor after choosing which account should be admin:

```sql
INSERT INTO public.profiles (id, is_admin)
SELECT id, true FROM auth.users WHERE email = 'you@example.com'
ON CONFLICT (id) DO UPDATE SET is_admin = true;
```

## Migration history

| File | What it does |
|---|---|
| `20250601000001_phase2_rfqs_items_suppliers.sql` | Core tables: `rfqs`, `rfq_items`, `suppliers`, plus the `rfq-files` storage bucket |
| `20250601000002_phase3_outgoing_rfqs.sql` | Supplier-facing split RFQs: `outgoing_rfqs`, `outgoing_rfq_items` |
| `20250601000003_phase4_buyer_reply_logs.sql` | `buyer_reply_logs` for the RFQ Reply feature |
| `20250601000004_admin_roles_and_settings.sql` | `profiles`/`is_admin()` role system, admin-aware RLS on all tables, `user_settings` |
| `20250601000005_hardening_indexes_and_rate_limits.sql` | Indexes on every `user_id` column, the missing `suppliers(user_id, name)` constraint, and the rate-limiting function |
