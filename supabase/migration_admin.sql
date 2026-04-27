-- =============================================
-- RFQ Flow — Admin Role Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- 1. Profiles table — marks who is an admin
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin   BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create a profile row whenever a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, is_admin)
  VALUES (new.id, false)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Everyone can read their own profile; admins can read all
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Only admins can update the is_admin flag (via service role / dashboard only)
-- No UPDATE policy = only service role can change is_admin


-- =============================================
-- 2. Update RLS policies on all tables to allow admin access
-- =============================================

-- Helper function: is the current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- RFQs
DROP POLICY IF EXISTS "Users see own rfqs" ON rfqs;
CREATE POLICY "Users see own rfqs"
  ON rfqs FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- RFQ Items
DROP POLICY IF EXISTS "Users see own items" ON rfq_items;
CREATE POLICY "Users see own items"
  ON rfq_items FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- Suppliers
DROP POLICY IF EXISTS "Users see own suppliers" ON suppliers;
CREATE POLICY "Users see own suppliers"
  ON suppliers FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- Outgoing RFQs
DROP POLICY IF EXISTS "Users see own outgoing rfqs" ON outgoing_rfqs;
CREATE POLICY "Users see own outgoing rfqs"
  ON outgoing_rfqs FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- Outgoing RFQ Items
DROP POLICY IF EXISTS "Users see own outgoing rfq items" ON outgoing_rfq_items;
CREATE POLICY "Users see own outgoing rfq items"
  ON outgoing_rfq_items FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());


-- =============================================
-- 3. Mark YOUR account as admin
--    Replace the email below with YOUR login email
-- =============================================

INSERT INTO public.profiles (id, is_admin)
SELECT id, true
FROM auth.users
WHERE email = 'YOUR_EMAIL_HERE'   -- ← change this to your email
ON CONFLICT (id) DO UPDATE SET is_admin = true;


-- =============================================
-- 4. User settings table (key-value store per user)
-- =============================================

CREATE TABLE IF NOT EXISTS user_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings"
  ON user_settings FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

-- Also add notes column to suppliers if it doesn't exist yet
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;


-- =============================================
-- RESULT:
-- • Regular users  → see only their own data (unchanged)
-- • You (admin)    → see ALL users' data when logged in
-- • No user can ever see another user's data
-- =============================================
