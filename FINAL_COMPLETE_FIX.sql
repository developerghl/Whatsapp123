-- =====================================================
-- COMPLETE FIX: Disable ALL RLS + Grant ALL Permissions
-- Copy and paste EVERYTHING below in Supabase SQL Editor
-- =====================================================

-- Step 1: Disable RLS on ALL tables
ALTER TABLE IF EXISTS public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subaccounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ghl_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_installations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.location_session_map DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subaccount_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subaccount_analytics DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.drip_queue DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.used_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subscription_events DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop ALL existing RLS policies
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- Step 3: Grant ALL permissions to ALL roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Step 4: Verify RLS is disabled
SELECT 
  tablename,
  CASE WHEN rowsecurity THEN '❌ ENABLED' ELSE '✅ DISABLED' END as rls_status
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'subaccounts', 'sessions', 'messages', 'ghl_accounts',
    'subaccount_settings', 'subaccount_analytics', 'drip_queue'
  )
ORDER BY tablename;

-- All should show ✅ DISABLED
