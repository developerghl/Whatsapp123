/**
 * Drip Queue Processor
 * Processes queued messages in batches with delays
 * Runs as background worker
 */

const subaccountHelpers = require('./subaccount-helpers');
const waManager = require('./baileys-wa');
const { createClient } = require('@supabase/supabase-js');

class DripQueueProcessor {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.supabaseAdmin = createClient(this.supabaseUrl, this.supabaseKey);
    this.processing = new Set(); // Track which accounts are currently processing
    this.intervals = new Map(); // Track interval IDs per account
  }

  /**
   * Start processing drip queues for all accounts
   */
  start() {
    console.log('🚀 Starting Drip Queue Processor...');
    
    // Process queues every 30 seconds
    setInterval(() => {
      this.processAllQueues().catch(err => {
        console.error('Error in drip queue processor:', err);
      });
    }, 30000); // Check every 30 seconds
  }

  /**
   * Process queues for all accounts
   */
  async processAllQueues() {
    try {
      // Get all accounts with pending messages
      const { data: accounts, error } = await this.supabaseAdmin
        .from('drip_queue')
        .select('ghl_account_id')
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true });

      if (error) {
        console.error('Error fetching drip queue accounts:', error);
        return;
      }

      if (!accounts || accounts.length === 0) {
        return; // No pending messages
      }

      // Get unique account IDs
      const uniqueAccountIds = [...new Set(accounts.map(a => a.ghl_account_id))];

      // Process each account
      for (const accountId of uniqueAccountIds) {
        if (this.processing.has(accountId)) {
          continue; // Skip if already processing
        }

        this.processAccountQueue(accountId).catch(err => {
          console.error(`Error processing queue for account ${accountId}:`, err);
          this.processing.delete(accountId);
        });
      }
    } catch (error) {
      console.error('Error in processAllQueues:', error);
    }
  }

  /**
   * Process queue for a specific account
   * @param {string} accountId - GHL account ID
   */
  async processAccountQueue(accountId) {
    if (this.processing.has(accountId)) {
      return; // Already processing
    }

    this.processing.add(accountId);

    try {
      // Get settings
      const settings = await subaccountHelpers.getSettings(accountId);
      
      if (!settings.drip_mode_enabled) {
        // Drip mode disabled - clear pending messages (send immediately)
        const { data: pending } = await this.supabaseAdmin
          .from('drip_queue')
          .select('*')
          .eq('ghl_account_id', accountId)
          .eq('status', 'pending')
          .order('scheduled_at', { ascending: true })
          .limit(100);

        if (pending && pending.length > 0) {
          for (const item of pending) {
            await this.sendQueuedMessage(item);
          }
        }
        return;
      }

      // Check if we should process a batch now
      const { data: lastBatch } = await this.supabaseAdmin
        .from('drip_queue')
        .select('processed_at, batch_number')
        .eq('ghl_account_id', accountId)
        .eq('status', 'sent')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const now = Date.now();
      const delayMs = settings.drip_delay_minutes * 60 * 1000;

      if (lastBatch && lastBatch.processed_at) {
        const lastBatchTime = new Date(lastBatch.processed_at).getTime();
        const timeSinceLastBatch = now - lastBatchTime;

        if (timeSinceLastBatch < delayMs) {
          // Not time for next batch yet
          return;
        }
      }

      // Get next batch
      const batch = await subaccountHelpers.getNextDripBatch(accountId, settings.drip_messages_per_batch);

      if (!batch || batch.length === 0) {
        return; // No messages to process
      }

      console.log(`📤 Processing drip batch: ${batch.length} messages for account ${accountId}`);

      // Get batch number
      const batchNumber = lastBatch ? (lastBatch.batch_number || 0) + 1 : 1;

      // Process each message in batch
      for (const item of batch) {
        await this.sendQueuedMessage(item, batchNumber);
      }

    } catch (error) {
      console.error(`Error processing queue for account ${accountId}:`, error);
    } finally {
      this.processing.delete(accountId);
    }
  }

  /**
   * Send a queued message
   * @param {Object} queueItem - Queue item from database
   * @param {number} batchNumber - Batch number
   */
  async sendQueuedMessage(queueItem, batchNumber = 0) {
    try {
      // Mark as processing
      await subaccountHelpers.markQueueProcessing(queueItem.id);

      // Get GHL account
      const { data: ghlAccount } = await this.supabaseAdmin
        .from('ghl_accounts')
        .select('*')
        .eq('id', queueItem.ghl_account_id)
        .maybeSingle();

      if (!ghlAccount) {
        await subaccountHelpers.markQueueFailed(queueItem.id, 'GHL account not found');
        return;
      }

      // Get active session
      const session = await subaccountHelpers.getActiveSession(ghlAccount.id);

      if (!session) {
        await subaccountHelpers.markQueueFailed(queueItem.id, 'No active WhatsApp session');
        return;
      }

      // Build client key
      const cleanSubaccountId = session.subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const clientKey = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      // Check client status
      const clientStatus = waManager.getClientStatus(clientKey);
      if (!clientStatus || (clientStatus.status !== 'connected' && clientStatus.status !== 'ready')) {
        await subaccountHelpers.markQueueFailed(queueItem.id, 'WhatsApp client not connected');
        return;
      }

      // Format phone number
      let phoneNumber = queueItem.phone;
      if (phoneNumber && !phoneNumber.startsWith('+')) {
        phoneNumber = '+' + phoneNumber.replace(/^\+/, '');
      }

      // Send message
      try {
        if (queueItem.attachments && queueItem.attachments.length > 0) {
          // Send with attachments (simplified - would need full attachment handling)
          await waManager.sendMessage(clientKey, phoneNumber, queueItem.message || '', 'text');
        } else {
          await waManager.sendMessage(clientKey, phoneNumber, queueItem.message || '', 'text');
        }

        // Mark as sent
        await subaccountHelpers.markQueueSent(queueItem.id);

        // Update batch number
        await this.supabaseAdmin
          .from('drip_queue')
          .update({ batch_number: batchNumber })
          .eq('id', queueItem.id);

        // Track analytics
        await subaccountHelpers.incrementAnalytics(ghlAccount.id, ghlAccount.user_id, 'sent');

        console.log(`✅ Sent queued message ${queueItem.id} to ${phoneNumber}`);
      } catch (sendError) {
        await subaccountHelpers.markQueueFailed(queueItem.id, sendError.message);
        console.error(`❌ Failed to send queued message ${queueItem.id}:`, sendError);
      }

    } catch (error) {
      console.error(`Error sending queued message ${queueItem.id}:`, error);
      await subaccountHelpers.markQueueFailed(queueItem.id, error.message);
    }
  }
}

module.exports = new DripQueueProcessor();
