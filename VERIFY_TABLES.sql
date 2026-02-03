-- Verify all tables are accessible
-- Run this to check if tables exist and are accessible

-- Check users table
SELECT COUNT(*) as total_users FROM public.users;

-- Check ghl_accounts table  
SELECT COUNT(*) as total_ghl_accounts FROM public.ghl_accounts;

-- Check if RLS is disabled on key tables
SELECT 
  tablename,
  CASE WHEN rowsecurity THEN '❌ RLS ENABLED' ELSE '✅ RLS DISABLED' END as status
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN ('users', 'ghl_accounts', 'sessions', 'subaccount_settings', 'subaccount_analytics')
ORDER BY tablename;

-- Check table permissions
SELECT 
  tablename,
  grantee,
  string_agg(privilege_type, ', ') as privileges
FROM information_schema.role_table_grants 
WHERE table_schema = 'public'
  AND table_name IN ('users', 'ghl_accounts')
GROUP BY tablename, grantee
ORDER BY tablename, grantee;
