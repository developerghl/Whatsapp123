-- =====================================================
-- Subaccount Settings & Analytics Migration
-- Adds: Settings, Analytics, Multi-Number Support, Drip Queue
-- =====================================================

-- 1. Subaccount Settings Table
CREATE TABLE IF NOT EXISTS subaccount_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ghl_account_id UUID REFERENCES ghl_accounts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Contact Creation Toggle
  create_contact_in_ghl BOOLEAN DEFAULT TRUE,
  
  -- Drip Mode Settings
  drip_mode_enabled BOOLEAN DEFAULT FALSE,
  drip_messages_per_batch INTEGER DEFAULT 20 CHECK (drip_messages_per_batch > 0),
  drip_delay_minutes INTEGER DEFAULT 5 CHECK (drip_delay_minutes >= 0),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one settings record per GHL account
  UNIQUE(ghl_account_id)
);

-- 2. Subaccount Analytics Table
CREATE TABLE IF NOT EXISTS subaccount_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ghl_account_id UUID REFERENCES ghl_accounts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Message Counters
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0,
  
  -- Daily counters (JSONB for flexibility)
  daily_stats JSONB DEFAULT '{}'::jsonb,
  
  -- Weekly counters
  weekly_stats JSONB DEFAULT '{}'::jsonb,
  
  -- Last activity
  last_message_sent_at TIMESTAMP WITH TIME ZONE,
  last_message_received_at TIMESTAMP WITH TIME ZONE,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one analytics record per GHL account
  UNIQUE(ghl_account_id)
);

-- 3. Update Sessions Table for Multi-Number Support
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS phone_number_display TEXT;

-- Create index for active session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_active_subaccount 
  ON sessions(subaccount_id, is_active) 
  WHERE is_active = TRUE;

-- 4. Drip Queue Table (Fault-tolerant message queue)
CREATE TABLE IF NOT EXISTS drip_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ghl_account_id UUID REFERENCES ghl_accounts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Message data
  contact_id TEXT,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  attachments JSONB DEFAULT '[]'::jsonb,
  
  -- Queue management
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  batch_number INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  
  -- Retry logic
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  
  -- Timestamps
  scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes for efficient queue processing
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'sent', 'failed'))
);

-- Indexes for drip queue
CREATE INDEX IF NOT EXISTS idx_drip_queue_status_scheduled 
  ON drip_queue(status, scheduled_at) 
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_drip_queue_ghl_account 
  ON drip_queue(ghl_account_id, status);

-- 5. Enable RLS on new tables
ALTER TABLE subaccount_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_queue ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for subaccount_settings
CREATE POLICY "Users can view their own subaccount settings"
  ON subaccount_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subaccount settings"
  ON subaccount_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subaccount settings"
  ON subaccount_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- 7. RLS Policies for subaccount_analytics
CREATE POLICY "Users can view their own subaccount analytics"
  ON subaccount_analytics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own subaccount analytics"
  ON subaccount_analytics FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role can manage analytics (for backend updates)
CREATE POLICY "Service role can manage analytics"
  ON subaccount_analytics FOR ALL
  USING (auth.role() = 'service_role');

-- 8. RLS Policies for drip_queue
CREATE POLICY "Users can view their own drip queue"
  ON drip_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own drip queue items"
  ON drip_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage drip queue"
  ON drip_queue FOR ALL
  USING (auth.role() = 'service_role');

-- 9. Function to initialize settings for existing GHL accounts
-- Only initializes for accounts where user_id exists in auth.users
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

-- 10. Function to initialize analytics for existing GHL accounts
-- Only initializes for accounts where user_id exists in auth.users
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

-- 11. Trigger to auto-create settings when GHL account is created
-- Only creates if user_id exists in auth.users (safety check)
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

CREATE TRIGGER trigger_create_subaccount_settings
  AFTER INSERT ON ghl_accounts
  FOR EACH ROW
  EXECUTE FUNCTION create_subaccount_settings_on_ghl_account();

-- 12. Initialize settings for existing accounts
SELECT initialize_subaccount_settings();
SELECT initialize_subaccount_analytics();

-- 13. Update updated_at timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_subaccount_settings_updated_at
  BEFORE UPDATE ON subaccount_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subaccount_analytics_updated_at
  BEFORE UPDATE ON subaccount_analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Migration Complete
-- =====================================================
