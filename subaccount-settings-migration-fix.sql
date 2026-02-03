-- =====================================================
-- Fix for Foreign Key Constraint Violation
-- This fixes the initialization functions to only process
-- ghl_accounts where user_id exists in auth.users
-- =====================================================

-- Fix initialization function for settings
CREATE OR REPLACE FUNCTION initialize_subaccount_settings()
RETURNS void AS $$
BEGIN
  INSERT INTO subaccount_settings (ghl_account_id, user_id, create_contact_in_ghl, drip_mode_enabled)
  SELECT ga.id, ga.user_id, TRUE, FALSE
  FROM ghl_accounts ga
  INNER JOIN auth.users au ON ga.user_id = au.id
  WHERE ga.id NOT IN (SELECT ghl_account_id FROM subaccount_settings WHERE ghl_account_id IS NOT NULL)
  ON CONFLICT (ghl_account_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Fix initialization function for analytics
CREATE OR REPLACE FUNCTION initialize_subaccount_analytics()
RETURNS void AS $$
BEGIN
  INSERT INTO subaccount_analytics (ghl_account_id, user_id)
  SELECT ga.id, ga.user_id
  FROM ghl_accounts ga
  INNER JOIN auth.users au ON ga.user_id = au.id
  WHERE ga.id NOT IN (SELECT ghl_account_id FROM subaccount_analytics WHERE ghl_account_id IS NOT NULL)
  ON CONFLICT (ghl_account_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Fix trigger function to verify user exists
CREATE OR REPLACE FUNCTION create_subaccount_settings_on_ghl_account()
RETURNS TRIGGER AS $$
BEGIN
  -- Verify user exists in auth.users before inserting
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
    INSERT INTO subaccount_settings (ghl_account_id, user_id, create_contact_in_ghl, drip_mode_enabled)
    VALUES (NEW.id, NEW.user_id, TRUE, FALSE)
    ON CONFLICT (ghl_account_id) DO NOTHING;
    
    INSERT INTO subaccount_analytics (ghl_account_id, user_id)
    VALUES (NEW.id, NEW.user_id)
    ON CONFLICT (ghl_account_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-run initialization (now safe)
SELECT initialize_subaccount_settings();
SELECT initialize_subaccount_analytics();

-- =====================================================
-- Optional: Clean up orphaned ghl_accounts (if needed)
-- Uncomment to remove ghl_accounts with invalid user_id
-- =====================================================

-- DELETE FROM ghl_accounts 
-- WHERE user_id NOT IN (SELECT id FROM auth.users);

-- =====================================================
-- Fix Complete
-- =====================================================
