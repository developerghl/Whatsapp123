/**
 * Subaccount Settings & Analytics Helpers
 * Handles settings, analytics tracking, and drip queue management
 */

const { createClient } = require('@supabase/supabase-js');

class SubaccountHelpers {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.supabaseAdmin = createClient(this.supabaseUrl, this.supabaseKey);
  }

  /**
   * Get subaccount settings (with defaults)
   * @param {string} ghlAccountId - GHL account ID
   * @returns {Promise<Object>} Settings object
   */
  async getSettings(ghlAccountId) {
    try {
      const { data, error } = await this.supabaseAdmin
        .from('subaccount_settings')
        .select('*')
        .eq('ghl_account_id', ghlAccountId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('Error fetching settings:', error);
      }

      // Return defaults if not found
      if (!data) {
        return {
          create_contact_in_ghl: true,
          drip_mode_enabled: false,
          drip_messages_per_batch: 20,
          drip_delay_minutes: 5
        };
      }

      return {
        create_contact_in_ghl: data.create_contact_in_ghl ?? true,
        drip_mode_enabled: data.drip_mode_enabled ?? false,
        drip_messages_per_batch: data.drip_messages_per_batch ?? 20,
        drip_delay_minutes: data.drip_delay_minutes ?? 5
      };
    } catch (error) {
      console.error('Error in getSettings:', error);
      // Return safe defaults
      return {
        create_contact_in_ghl: true,
        drip_mode_enabled: false,
        drip_messages_per_batch: 20,
        drip_delay_minutes: 5
      };
    }
  }

  /**
   * Update subaccount settings
   * @param {string} ghlAccountId - GHL account ID
   * @param {string} userId - User ID
   * @param {Object} settings - Settings to update
   */
  async updateSettings(ghlAccountId, userId, settings) {
    try {
      const { data, error } = await this.supabaseAdmin
        .from('subaccount_settings')
        .upsert({
          ghl_account_id: ghlAccountId,
          user_id: userId,
          ...settings,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'ghl_account_id'
        })
        .select()
        .single();

      if (error) {
        console.error('Error updating settings:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in updateSettings:', error);
      throw error;
    }
  }

  /**
   * Increment analytics counter
   * @param {string} ghlAccountId - GHL account ID
   * @param {string} userId - User ID
   * @param {string} type - 'sent' or 'received'
   */
  async incrementAnalytics(ghlAccountId, userId, type) {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const weekKey = this.getWeekKey(now);

      // Get current analytics
      const { data: current } = await this.supabaseAdmin
        .from('subaccount_analytics')
        .select('*')
        .eq('ghl_account_id', ghlAccountId)
        .maybeSingle();

      // Initialize if doesn't exist
      if (!current) {
        const { data: newAnalytics } = await this.supabaseAdmin
          .from('subaccount_analytics')
          .insert({
            ghl_account_id: ghlAccountId,
            user_id: userId,
            total_messages_sent: type === 'sent' ? 1 : 0,
            total_messages_received: type === 'received' ? 1 : 0,
            daily_stats: type === 'sent' 
              ? { [today]: { sent: 1, received: 0 } }
              : { [today]: { sent: 0, received: 1 } },
            weekly_stats: type === 'sent'
              ? { [weekKey]: { sent: 1, received: 0 } }
              : { [weekKey]: { sent: 0, received: 1 } },
            [`last_message_${type}_at`]: now.toISOString(),
            last_activity_at: now.toISOString()
          })
          .select()
          .single();

        return newAnalytics;
      }

      // Update existing analytics
      const dailyStats = current.daily_stats || {};
      const weeklyStats = current.weekly_stats || {};

      // Update daily stats
      if (!dailyStats[today]) {
        dailyStats[today] = { sent: 0, received: 0 };
      }
      dailyStats[today][type] = (dailyStats[today][type] || 0) + 1;

      // Update weekly stats
      if (!weeklyStats[weekKey]) {
        weeklyStats[weekKey] = { sent: 0, received: 0 };
      }
      weeklyStats[weekKey][type] = (weeklyStats[weekKey][type] || 0) + 1;

      // Update totals
      const updateData = {
        [`total_messages_${type}`]: (current[`total_messages_${type}`] || 0) + 1,
        daily_stats: dailyStats,
        weekly_stats: weeklyStats,
        [`last_message_${type}_at`]: now.toISOString(),
        last_activity_at: now.toISOString(),
        updated_at: now.toISOString()
      };

      const { data: updated, error } = await this.supabaseAdmin
        .from('subaccount_analytics')
        .update(updateData)
        .eq('ghl_account_id', ghlAccountId)
        .select()
        .single();

      if (error) {
        console.error('Error updating analytics:', error);
        throw error;
      }

      return updated;
    } catch (error) {
      console.error('Error in incrementAnalytics:', error);
      // Don't throw - analytics failures shouldn't break message flow
      return null;
    }
  }

  /**
   * Get analytics for subaccount
   * @param {string} ghlAccountId - GHL account ID
   * @returns {Promise<Object>} Analytics data
   */
  async getAnalytics(ghlAccountId) {
    try {
      const { data, error } = await this.supabaseAdmin
        .from('subaccount_analytics')
        .select('*')
        .eq('ghl_account_id', ghlAccountId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching analytics:', error);
      }

      // Return defaults if not found
      if (!data) {
        return {
          total_messages_sent: 0,
          total_messages_received: 0,
          daily_stats: {},
          weekly_stats: {},
          last_message_sent_at: null,
          last_message_received_at: null,
          last_activity_at: null
        };
      }

      return data;
    } catch (error) {
      console.error('Error in getAnalytics:', error);
      return {
        total_messages_sent: 0,
        total_messages_received: 0,
        daily_stats: {},
        weekly_stats: {},
        last_message_sent_at: null,
        last_message_received_at: null,
        last_activity_at: null
      };
    }
  }

  /**
   * Add message to drip queue
   * @param {string} ghlAccountId - GHL account ID
   * @param {string} userId - User ID
   * @param {Object} messageData - Message data
   */
  async addToDripQueue(ghlAccountId, userId, messageData) {
    try {
      const { data, error } = await this.supabaseAdmin
        .from('drip_queue')
        .insert({
          ghl_account_id: ghlAccountId,
          user_id: userId,
          contact_id: messageData.contactId || null,
          phone: messageData.phone,
          message: messageData.message || '',
          message_type: messageData.messageType || 'text',
          attachments: messageData.attachments || [],
          status: 'pending',
          scheduled_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Error adding to drip queue:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in addToDripQueue:', error);
      throw error;
    }
  }

  /**
   * Get next batch from drip queue
   * @param {string} ghlAccountId - GHL account ID
   * @param {number} batchSize - Number of messages per batch
   * @returns {Promise<Array>} Queue items
   */
  async getNextDripBatch(ghlAccountId, batchSize) {
    try {
      const { data, error } = await this.supabaseAdmin
        .from('drip_queue')
        .select('*')
        .eq('ghl_account_id', ghlAccountId)
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true })
        .limit(batchSize);

      if (error) {
        console.error('Error getting drip batch:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getNextDripBatch:', error);
      return [];
    }
  }

  /**
   * Mark queue item as processing
   * @param {string} queueId - Queue item ID
   */
  async markQueueProcessing(queueId) {
    try {
      await this.supabaseAdmin
        .from('drip_queue')
        .update({
          status: 'processing',
          processed_at: new Date().toISOString()
        })
        .eq('id', queueId);
    } catch (error) {
      console.error('Error marking queue processing:', error);
    }
  }

  /**
   * Mark queue item as sent
   * @param {string} queueId - Queue item ID
   */
  async markQueueSent(queueId) {
    try {
      await this.supabaseAdmin
        .from('drip_queue')
        .update({
          status: 'sent',
          processed_at: new Date().toISOString()
        })
        .eq('id', queueId);
    } catch (error) {
      console.error('Error marking queue sent:', error);
    }
  }

  /**
   * Mark queue item as failed
   * @param {string} queueId - Queue item ID
   * @param {string} errorMessage - Error message
   */
  async markQueueFailed(queueId, errorMessage) {
    try {
      const { data: item } = await this.supabaseAdmin
        .from('drip_queue')
        .select('retry_count, max_retries')
        .eq('id', queueId)
        .single();

      const retryCount = (item?.retry_count || 0) + 1;
      const maxRetries = item?.max_retries || 3;

      await this.supabaseAdmin
        .from('drip_queue')
        .update({
          status: retryCount >= maxRetries ? 'failed' : 'pending',
          retry_count: retryCount,
          error_message: errorMessage,
          scheduled_at: retryCount < maxRetries 
            ? new Date(Date.now() + 5 * 60 * 1000).toISOString() // Retry in 5 minutes
            : new Date().toISOString()
        })
        .eq('id', queueId);
    } catch (error) {
      console.error('Error marking queue failed:', error);
    }
  }

  /**
   * Get active session for subaccount (multi-number support)
   * @param {string} ghlAccountId - GHL account ID
   * @returns {Promise<Object|null>} Active session
   */
  async getActiveSession(ghlAccountId) {
    try {
      const { data, error } = await this.supabaseAdmin
        .from('sessions')
        .select('*')
        .eq('subaccount_id', ghlAccountId)
        .eq('is_active', true)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error getting active session:', error);
      }

      return data || null;
    } catch (error) {
      console.error('Error in getActiveSession:', error);
      return null;
    }
  }

  /**
   * Set session as active (deactivate others)
   * @param {string} sessionId - Session ID to activate
   * @param {string} ghlAccountId - GHL account ID
   */
  async setActiveSession(sessionId, ghlAccountId) {
    try {
      // Deactivate all other sessions for this subaccount
      await this.supabaseAdmin
        .from('sessions')
        .update({ is_active: false })
        .eq('subaccount_id', ghlAccountId)
        .neq('id', sessionId);

      // Activate this session
      await this.supabaseAdmin
        .from('sessions')
        .update({ is_active: true })
        .eq('id', sessionId);
    } catch (error) {
      console.error('Error setting active session:', error);
      throw error;
    }
  }

  /**
   * Get week key for analytics (YYYY-WW format)
   * @param {Date} date - Date object
   * @returns {string} Week key
   */
  getWeekKey(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7)); // Thursday
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${week.toString().padStart(2, '0')}`;
  }
}

module.exports = new SubaccountHelpers();
