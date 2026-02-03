const { 
  makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState, 
  downloadMediaMessage,
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const emailService = require('./email');

/**
 * BaileysWhatsAppManager - Production-ready WhatsApp connection manager
 * 
 * Features:
 * - Multi-user safe session handling with useMultiFileAuthState
 * - Auto-fetch latest WhatsApp Web version
 * - Automatic reconnection logic (except when logged out)
 * - Connection timeout to prevent stuck states
 * - Health monitoring and QR expiry cleanup
 * - Production-stable connection management
 */
class BaileysWhatsAppManager {
  constructor() {
    // Store active WhatsApp clients (sessionId -> client info)
    this.clients = new Map();
    
    // Data directory for storing auth credentials
    this.dataDir = path.join(__dirname, '../data');
    this.ensureDataDir();
    
    // QR generation queue to prevent conflicts (sequential processing)
    this.qrQueue = [];
    this.isGeneratingQR = false;
    
    // Connection timeout configuration (prevent stuck on "connecting")
    this.CONNECTION_TIMEOUT = 120000; // 2 minutes max connection time
    this.RECONNECT_DELAY = 5000; // 5 seconds delay before reconnecting
    
    // Start background monitors
    this.startHealthMonitor();
    this.startQRCleanupMonitor();
    this.startConnectionTimeoutMonitor();
  }

  // Make clients accessible for phone number retrieval
  getClientsMap() {
    return this.clients;
  }

  // Get client by session ID (for media decryption)
  getClient(sessionId) {
    return this.clients.get(sessionId);
  }

  // Clear session data to force fresh connection
  clearSessionData(sessionId) {
    try {
      const authDir = path.join(this.dataDir, `baileys_${sessionId}`);
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
        console.log(`🗑️ Cleared session data for: ${sessionId}`);
      }
      this.clients.delete(sessionId);
    } catch (error) {
      console.error(`❌ Error clearing session data for ${sessionId}:`, error);
    }
  }


  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // Connection health monitor
  startHealthMonitor() {
    setInterval(() => {
      this.clients.forEach((client, sessionId) => {
        if (client.status === 'connected') {
          const timeSinceLastUpdate = Date.now() - client.lastUpdate;
          
          // If no update for more than 2 minutes, check connection
          if (timeSinceLastUpdate > 120000) {
            console.log(`🔍 Health check for ${sessionId}: Last update ${Math.round(timeSinceLastUpdate/1000)}s ago`);
            
            // Try to send a ping to check if connection is alive
            try {
              if (client.socket && client.socket.user) {
                // Connection seems alive, update timestamp
                client.lastUpdate = Date.now();
                console.log(`✅ Connection healthy for ${sessionId}`);
              } else {
                console.log(`⚠️ Connection lost for ${sessionId}, marking as disconnected`);
                client.status = 'disconnected';
                client.lastUpdate = Date.now();
              }
            } catch (error) {
              console.log(`❌ Health check failed for ${sessionId}:`, error.message);
              client.status = 'disconnected';
              client.lastUpdate = Date.now();
            }
          }
        }
      });
    }, 30000); // Check every 30 seconds
  }

  /**
   * QR expiry cleanup monitor
   * Automatically cleans up expired QR codes (older than 5 minutes)
   */
  startQRCleanupMonitor() {
    setInterval(async () => {
      const QR_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      
      for (const [sessionId, client] of this.clients.entries()) {
        // Only check QR-ready sessions
        if (client.status === 'qr_ready' && client.qrGeneratedAt) {
          const qrAge = now - client.qrGeneratedAt;
          
          if (qrAge > QR_EXPIRY_TIME) {
            console.log(`🧹 Auto-cleaning expired QR session: ${sessionId} (${Math.round(qrAge/1000)}s old)`);
            
            try {
              // Update database status
              await this.updateDatabaseStatus(sessionId, 'disconnected');
              
              // Disconnect and cleanup
              await this.disconnectClient(sessionId);
              this.clearSessionData(sessionId);
              
              console.log(`✨ Session ${sessionId} cleaned up. Will regenerate fresh QR on next access.`);
            } catch (err) {
              console.error(`Error cleaning up ${sessionId}:`, err.message);
            }
          }
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Connection timeout monitor
   * Prevents connections from getting stuck on "connecting" state
   * Automatically marks as disconnected if stuck for too long
   */
  startConnectionTimeoutMonitor() {
    setInterval(() => {
      const now = Date.now();
      
      for (const [sessionId, client] of this.clients.entries()) {
        // Check if connection is stuck on "connecting" state
        if (client.status === 'connecting' && client.connectingSince) {
          const timeSinceConnecting = now - client.connectingSince;
          
          // If stuck on connecting for more than CONNECTION_TIMEOUT, mark as disconnected
          if (timeSinceConnecting > this.CONNECTION_TIMEOUT) {
            console.log(`⏱️ Connection timeout for ${sessionId}: Stuck on connecting for ${Math.round(timeSinceConnecting/1000)}s`);
            
            // Update status to disconnected
            client.status = 'disconnected';
            client.lastUpdate = Date.now();
            
            // Update database
            this.updateDatabaseStatus(sessionId, 'disconnected', null).catch(err => {
              console.error(`❌ Failed to update database on timeout: ${err.message}`);
            });
            
            // Attempt reconnection (only if not logged out)
            if (client.socket && !client.isLoggedOut) {
              console.log(`🔄 Attempting reconnection after timeout for: ${sessionId}`);
              setTimeout(() => {
                this.createClient(sessionId).catch(err => {
                  console.error(`❌ Reconnection failed after timeout: ${err.message}`);
                });
              }, this.RECONNECT_DELAY);
            }
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }

  hasExistingCredentials(sessionId) {
    const authDir = path.join(this.dataDir, `baileys_${sessionId}`);
    const credsFile = path.join(authDir, 'creds.json');
    return fs.existsSync(credsFile);
  }

  async createClient(sessionId) {
    try {
      console.log(`🚀 Creating Baileys client for session: ${sessionId}`);
      
      // Extract subaccount ID from sessionId to prevent multiple connections
      const sessionIdParts = sessionId.split('_');
      const subaccountId = sessionIdParts.length >= 2 ? sessionIdParts[1] : null;
      
      if (subaccountId) {
        // Check if there's already a connected client for this subaccount
        for (const [key, client] of this.clients) {
          if (key.includes(subaccountId) && (client.status === 'connected' || client.status === 'ready')) {
            console.log(`⚠️ Subaccount ${subaccountId} already has a connected client: ${key}`);
            console.log(`🔄 Reusing existing connected client instead of creating new one`);
            return client.socket;
          }
        }
      }
      
      // Check if client already exists and is still valid
      if (this.clients.has(sessionId)) {
        const existingClient = this.clients.get(sessionId);
        const timeSinceLastUpdate = Date.now() - existingClient.lastUpdate;
        
        // If client is connected and recently updated, return it
        if (existingClient.status === 'connected' && timeSinceLastUpdate < 300000) { // 5 minutes
          console.log(`✅ Using existing connected client for session: ${sessionId}`);
          return existingClient.socket;
        }
        
        // If client is disconnected for too long, remove it
        if (existingClient.status === 'disconnected' && timeSinceLastUpdate > 60000) { // 1 minute
          console.log(`🗑️ Removing stale disconnected client for session: ${sessionId}`);
          this.clients.delete(sessionId);
        } else if (existingClient.status === 'disconnected') {
          console.log(`⚠️ Client exists but disconnected for session: ${sessionId}, recreating...`);
          this.clients.delete(sessionId);
        }
      }
      
      // Check again if there's already a connected client for this subaccount
      if (subaccountId) {
        for (const [clientKey, client] of this.clients.entries()) {
          if (clientKey.includes(subaccountId) && client.status === 'connected') {
            console.log(`⚠️ Subaccount ${subaccountId} already has connected client: ${clientKey}`);
            console.log(`🚫 Skipping creation of duplicate client: ${sessionId}`);
            return null; // Don't create duplicate client
          }
        }
      }
      
      // Add to QR queue to prevent conflicts
      return new Promise((resolve, reject) => {
        this.qrQueue.push({ sessionId, resolve, reject });
        this.processQRQueue();
      });
    } catch (error) {
      console.error(`❌ Error creating client for session ${sessionId}:`, error);
      throw error;
    }
  }
  
  async processQRQueue() {
    if (this.isGeneratingQR || this.qrQueue.length === 0) {
      return;
    }
    
    this.isGeneratingQR = true;
    const { sessionId, resolve, reject } = this.qrQueue.shift();
    
    try {
      console.log(`🔄 Processing QR queue for session: ${sessionId}`);
      const socket = await this.createClientInternal(sessionId);
      
      // Handle timeout gracefully - don't reject, just log
      if (!socket) {
        console.warn(`⏱️ [${sessionId}] Socket creation returned null (likely timeout) - will retry`);
        // Resolve with null instead of rejecting to prevent unhandled rejection
        resolve(null);
      } else {
        resolve(socket);
      }
    } catch (error) {
      // Handle timeout errors specifically
      const errorMessage = error.message || error.toString() || '';
      const isTimeout = errorMessage.includes('Timed Out') || 
                       errorMessage.includes('timeout') || 
                       errorMessage.includes('Request Time-out') ||
                       (error.output && error.output.statusCode === 408);
      
      if (isTimeout) {
        console.warn(`⏱️ [${sessionId}] Timeout in QR queue - resolving with null for retry`);
        resolve(null); // Don't reject - allow retry
      } else {
        console.error(`❌ [${sessionId}] Error in QR queue:`, error.message || error);
        reject(error);
      }
    } finally {
      this.isGeneratingQR = false;
      // Process next in queue after a delay
      setTimeout(() => this.processQRQueue(), 3000); // 3 second delay between QR generations
    }
  }
  
  async createClientInternal(sessionId) {
    try {
      const authDir = path.join(this.dataDir, `baileys_${sessionId}`);
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      
      // Check if we have existing credentials
      const hasCredentials = this.hasExistingCredentials(sessionId);
      console.log(`📋 Session ${sessionId} has existing credentials: ${hasCredentials}`);
      
      // If this is a fresh session (no credentials), skip restoration
      if (!hasCredentials) {
        console.log(`🆕 Fresh session detected, skipping restoration checks`);
      }

      // Fetch the latest WhatsApp Web version dynamically using Baileys built-in function
      // This ensures we always use the latest compatible version
      let version;
      try {
        const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
        version = latestVersion;
        console.log(`📱 [${sessionId}] Using WA Web v${version.join(".")}, isLatest: ${isLatest}`);
      } catch (error) {
        console.warn(`⚠️ [${sessionId}] Failed to fetch latest Baileys version: ${error.message}`);
        console.warn(`⚠️ Using fallback version: [2, 3000, 1025190524]`);
        // Fallback to a known working version
        version = [2, 3000, 1025190524];
      }
      
      // Wrap socket creation in timeout protection
      let socket;
      try {
        socket = makeWASocket({
        auth: state,
        logger: {
          level: 'silent',
          child: () => ({ 
            level: 'silent',
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {}
          }),
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {}
        },
        browser: ['Octendr', 'Chrome', '1.0.0'],
        version: version, // Use the dynamically fetched version
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        defaultQueryTimeoutMs: 120000, // 120 seconds (2 minutes) - increased for slow connections
        keepAliveIntervalMs: 8000, // Keep-alive every 8 seconds (more frequent for 6.7.21 - prevents disconnection)
        connectTimeoutMs: 180000, // 3 minutes connection timeout (increased)
        retryRequestDelayMs: 3000, // 3 seconds delay between retries (increased)
        maxMsgRetryCount: 3,
        heartbeatIntervalMs: 20000, // Heartbeat every 20 seconds (more frequent for 6.7.21 - prevents disconnection)
        printQRInTerminal: false,
        // Removed msgRetryCounterCache - let Baileys use its default cache implementation
        // This prevents "msgRetryCache.del is not a function" error
        getMessage: async (key) => {
          return {
            conversation: 'Hello from Octendr!'
          };
        },
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: () => false,
        fireInitQueries: true,
        emitOwnEvents: false
        });
        
        // Add error handler to catch timeout and other errors
        socket.ev.on('error', (error) => {
          console.error(`❌ [${sessionId}] Baileys socket error:`, error.message || error);
          
          // Handle timeout errors specifically - don't crash
          const errorMessage = error.message || error.toString() || '';
          const isTimeout = errorMessage.includes('Timed Out') || 
                           errorMessage.includes('timeout') || 
                           errorMessage.includes('Request Time-out') ||
                           (error.output && error.output.statusCode === 408);
          
          if (isTimeout) {
            console.warn(`⏱️ [${sessionId}] Timeout error detected - this is usually recoverable`);
            // Don't throw - let reconnection logic handle it
            return;
          }
          
          // For other errors, log but don't crash
          console.warn(`⚠️ [${sessionId}] Non-critical socket error:`, error.message || error);
        });
        
      } catch (socketError) {
        // Handle socket creation errors (including timeouts) - don't crash
        const errorMessage = socketError.message || socketError.toString() || '';
        const isTimeout = errorMessage.includes('Timed Out') || 
                         errorMessage.includes('timeout') || 
                         errorMessage.includes('Request Time-out') ||
                         (socketError.output && socketError.output.statusCode === 408);
        
        if (isTimeout) {
          console.warn(`⏱️ [${sessionId}] Socket creation timeout - will retry`);
          // Mark as disconnected and let retry logic handle it
          this.clients.set(sessionId, {
            socket: null,
            qr: null,
            status: 'disconnected',
            lastUpdate: Date.now(),
            isLoggedOut: false
          });
          // Return null instead of throwing to prevent unhandled rejection
          return null;
        }
        console.error(`❌ [${sessionId}] Error creating socket:`, socketError.message || socketError);
        throw socketError;
      }

      // Handle connection updates with stability check
      let connectionStable = false;
      let stabilityTimer = null;
      let connectionOpenTime = null;
      
      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin, isOnline } = update;
        
        console.log(`🔄 Connection update for ${sessionId}:`, { 
          connection: connection || 'undefined', 
          hasQR: !!qr, 
          isNewLogin, 
          isOnline,
          lastDisconnect: lastDisconnect?.error?.message,
          stable: connectionStable
        });
        
      if (qr) {
        console.log(`📱 QR Code generated for session: ${sessionId}`);
        
        // Only set qr_ready if not already connected AND connection is not stable
        if (!connectionStable && (!this.clients.has(sessionId) || this.clients.get(sessionId).status !== 'connected')) {
          this.clients.set(sessionId, {
            socket,
            qr,
            status: 'qr_ready',
            lastUpdate: Date.now(),
            qrGeneratedAt: Date.now() // Track when QR was generated
          });
          console.log(`📱 Status set to 'qr_ready' for session: ${sessionId} at ${new Date().toLocaleTimeString()}`);
        } else if (connectionStable) {
          console.log(`🚫 Ignoring QR generation - connection is stable for session: ${sessionId}`);
        } else {
          console.log(`🚫 Ignoring QR generation - client already connected for session: ${sessionId}`);
        }
      }
        
        if (connection === 'close') {
          // Clear stability timer if connection closes
          if (stabilityTimer) {
            clearTimeout(stabilityTimer);
            stabilityTimer = null;
          }
          connectionStable = false;
          connectionOpenTime = null;
          
          const disconnectStatusCode = (lastDisconnect?.error)?.output?.statusCode;
          const disconnectMessage = lastDisconnect?.error?.message || '';
          const isLoggedOut = disconnectStatusCode === DisconnectReason.loggedOut;
          const isRestartRequired = disconnectStatusCode === DisconnectReason.restartRequired;
          
          // Detect system-caused disconnections (not user logout)
          // System disconnections include: connectionLost, connectionClosed, timedOut, badSession, etc.
          const isSystemDisconnect = !isLoggedOut && (
            disconnectStatusCode === DisconnectReason.connectionClosed ||
            disconnectStatusCode === DisconnectReason.connectionLost ||
            disconnectStatusCode === DisconnectReason.connectionReplaced ||
            disconnectStatusCode === DisconnectReason.timedOut ||
            disconnectStatusCode === DisconnectReason.badSession ||
            disconnectMessage.includes('Timed Out') ||
            disconnectMessage.includes('timeout') ||
            disconnectMessage.includes('Connection closed') ||
            disconnectMessage.includes('Connection lost') ||
            (!disconnectStatusCode && !isLoggedOut) // Unknown disconnect = likely system issue
          );
          
          // According to Baileys docs: after QR scan, WhatsApp forcibly disconnects with restartRequired
          // This is NOT an error - we must create a new socket
          // https://baileys.wiki/docs/socket/connecting/
          if (isRestartRequired) {
            console.log(`🔄 Restart required (normal after QR scan) for session: ${sessionId}`);
            console.log(`📱 Creating new socket as per Baileys docs...`);
            
            // Clear old client and create new one
            if (this.clients.has(sessionId)) {
              const oldClient = this.clients.get(sessionId);
              // Clean up old socket
              try {
                if (oldClient.socket && oldClient.socket.end) {
                  oldClient.socket.end();
                }
              } catch (e) {
                console.warn(`⚠️ Error ending old socket: ${e.message}`);
              }
            }
            
            // Create new client (this will trigger reconnection)
            setTimeout(() => {
              this.createClient(sessionId).catch(err => {
                console.error(`❌ Failed to recreate socket after restartRequired: ${err}`);
              });
            }, 1000); // Small delay before recreating
            
            return; // Don't proceed with normal reconnection logic
          }
          
          // Determine if we should reconnect (don't reconnect if logged out)
          const shouldReconnect = !isLoggedOut;
          
          console.log(`🔌 Connection closed for session: ${sessionId}`);
          console.log(`🔌 Should reconnect: ${shouldReconnect}`);
          console.log(`🔌 Disconnect reason:`, disconnectMessage);
          console.log(`🔌 Disconnect status code: ${disconnectStatusCode}`);
          console.log(`🔌 Is system disconnect: ${isSystemDisconnect}`);
          
          // Update client status
          if (this.clients.has(sessionId)) {
            const client = this.clients.get(sessionId);
            client.status = 'disconnected';
            client.lastUpdate = Date.now();
            client.isLoggedOut = isLoggedOut; // Track logout state
            client.connectingSince = null; // Clear connecting timestamp
            client.disconnectReason = disconnectMessage; // Store disconnect reason
            client.disconnectCode = disconnectStatusCode; // Store disconnect code
          }
          
          // Update database status to disconnected (even if we'll reconnect)
          // This ensures dashboard shows real-time disconnect status
          this.updateDatabaseStatus(sessionId, 'disconnected', null).catch(err => {
            console.error(`❌ Failed to update database on disconnect: ${err.message}`);
          });
          
          // NOTE: No email sent immediately on system disconnect
          // Email will only be sent if reconnection fails after all attempts
          // This prevents spam emails during temporary network issues
          
          if (shouldReconnect) {
            // Auto-reconnect logic (only if not logged out)
            console.log(`🔄 Auto-reconnecting session: ${sessionId} in ${this.RECONNECT_DELAY/1000} seconds...`);
            
            // Use shorter delay for faster reconnection (production-optimized)
            setTimeout(() => {
              // Double-check client status before reconnecting
              const currentClient = this.clients.get(sessionId);
              
              // Only reconnect if:
              // 1. Client still exists
              // 2. Client is still disconnected (not already reconnected)
              // 3. Client is not logged out
              if (currentClient && 
                  currentClient.status === 'disconnected' && 
                  !currentClient.isLoggedOut) {
                console.log(`🔄 Attempting reconnection for: ${sessionId}`);
                this.createClient(sessionId).catch(err => {
                  console.error(`❌ Reconnection failed for ${sessionId}:`, err.message);
                  
                  // Retry once more after longer delay if first attempt fails
                  setTimeout(() => {
                    const retryClient = this.clients.get(sessionId);
                    if (retryClient && retryClient.status === 'disconnected' && !retryClient.isLoggedOut) {
                      console.log(`🔄 Retrying reconnection for: ${sessionId}`);
                      this.createClient(sessionId).catch(async retryErr => {
                        console.error(`❌ Reconnection retry failed for ${sessionId}:`, retryErr.message);
                        
                        // Send email ONLY if:
                        // 1. All reconnection attempts failed
                        // 2. Dashboard status is STILL "disconnected" (verified from database)
                        // 3. Client status is STILL "disconnected" (not reconnected)
                  if (isSystemDisconnect) {
                          // Wait a moment for any potential reconnection to complete
                          await new Promise(resolve => setTimeout(resolve, 2000));
                          
                          // Check actual database status before sending email
                          const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
                          const supabaseUrl = process.env.SUPABASE_URL;
                          const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
                          const supabaseAdmin = createSupabaseClient(supabaseUrl, supabaseKey);
                          
                          const sessionIdParts = sessionId.split('_');
                          const actualSessionId = sessionIdParts.slice(2).join('_');
                          
                          const { data: session } = await supabaseAdmin
                            .from('sessions')
                            .select('status')
                            .eq('id', actualSessionId)
                            .maybeSingle();
                          
                          // Get current client status
                          const finalClient = this.clients.get(sessionId);
                          const clientStillDisconnected = finalClient && finalClient.status === 'disconnected';
                          
                          // Only send email if BOTH database and client show disconnected
                          if (session && session.status === 'disconnected' && clientStillDisconnected) {
                            console.log(`📧 Verified: Dashboard status is "disconnected" - sending email`);
                            this.sendDisconnectEmail(sessionId, 'system_dashboard', {
                      reason: disconnectMessage,
                      code: disconnectStatusCode,
                              reconnectError: retryErr.message,
                      timestamp: new Date().toISOString()
                    }).catch(emailErr => {
                              console.error(`❌ Failed to send disconnect email: ${emailErr.message}`);
                    });
                          } else {
                            console.log(`✅ Status is not disconnected (DB: ${session?.status}, Client: ${finalClient?.status}) - skipping email`);
                          }
                        }
                      });
                    }
                  }, this.RECONNECT_DELAY * 2); // 10 seconds for retry
                });
              } else {
                console.log(`✅ Client ${sessionId} already reconnected or logged out, skipping reconnection`);
              }
            }, this.RECONNECT_DELAY); // 5 seconds delay (faster reconnection)
          } else {
            // Logged out - cleanup and remove client
            console.log(`📱 Mobile disconnected (logged out) for session: ${sessionId}`);
            
            // Update database status to disconnected
            this.updateDatabaseStatus(sessionId, 'disconnected', null).catch(err => {
              console.error(`❌ Failed to update database on logout: ${err.message}`);
            });
            
            // Send email notification for mobile disconnect (user logout)
            this.sendDisconnectEmail(sessionId, 'mobile').catch(err => {
              console.error(`❌ Failed to send disconnect email: ${err.message}`);
            });
            
            // Mark as logged out and remove from memory
            if (this.clients.has(sessionId)) {
              const client = this.clients.get(sessionId);
              client.isLoggedOut = true;
              client.status = 'disconnected';
            }
            
            // Don't delete immediately - let cleanup happen naturally
            // This prevents immediate reconnection attempts
          }
        }
        
        else if (connection === 'open') {
          // Connection successfully established
          connectionOpenTime = Date.now();
          connectionStable = true;
          
          // Clear any connection timeout
          if (stabilityTimer) {
            clearTimeout(stabilityTimer);
            stabilityTimer = null;
          }
          
          const phoneNumber = socket.user?.id?.split(':')[0] || 'Unknown';
          
          console.log(`✅ WhatsApp connected for session: ${sessionId}`);
          console.log(`📱 Phone number: ${phoneNumber}`);
          
          // Update client status to connected immediately
          this.clients.set(sessionId, {
            socket,
            qr: null,
            status: 'connected',
            phoneNumber: phoneNumber,
            lastUpdate: Date.now(),
            connectedAt: Date.now(),
            connectingSince: null, // Clear connecting timestamp
            isLoggedOut: false
          });
          
          console.log(`🔒 Status set to 'connected' for session: ${sessionId}`);
          
          // Update database status immediately
          console.log(`📊 Updating database status to 'ready' for session: ${sessionId}`);
          this.updateDatabaseStatus(sessionId, 'ready', phoneNumber);
          
          // Auto-activate this session if it's the first active one for this subaccount
          // Extract subaccount_id from sessionId (format: subaccount_<id>_<sessionId>)
          try {
            const sessionParts = sessionId.split('_');
            if (sessionParts.length >= 3) {
              const subaccountId = sessionParts[1];
              const subaccountHelpers = require('./subaccount-helpers');
              
              // Check if there's already an active session
              const activeSession = await subaccountHelpers.getActiveSession(subaccountId);
              
              // If no active session, make this one active
              if (!activeSession) {
                // Get session ID from database using subaccount_id
                const { createClient } = require('@supabase/supabase-js');
                const supabaseAdmin = createClient(
                  process.env.SUPABASE_URL,
                  process.env.SUPABASE_SERVICE_ROLE_KEY
                );
                
                const { data: session } = await supabaseAdmin
                  .from('sessions')
                  .select('id')
                  .eq('subaccount_id', subaccountId)
                  .eq('status', 'ready')
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                
                if (session) {
                  await subaccountHelpers.setActiveSession(session.id, subaccountId);
                  console.log(`✅ Auto-activated session ${session.id} for subaccount ${subaccountId}`);
                }
              }
            }
          } catch (autoActivateError) {
            // Non-critical - log but don't fail
            console.error('Error auto-activating session:', autoActivateError);
          }
          
          // Update lastUpdate periodically to keep connection alive
          // Store interval ID to cleanup later if needed
          const updateInterval = setInterval(() => {
            if (this.clients.has(sessionId)) {
              const client = this.clients.get(sessionId);
              if (client.status === 'connected') {
                client.lastUpdate = Date.now();
              } else {
                // Stop updating if client is no longer connected
                clearInterval(updateInterval);
              }
            } else {
              // Stop updating if client no longer exists
              clearInterval(updateInterval);
            }
          }, 30000); // Update every 30 seconds
          
        } else if (connection === 'connecting') {
          // Connection is in progress - set connecting state with timestamp
          console.log(`🔄 Connecting session: ${sessionId}`);
          const currentClient = this.clients.get(sessionId);
          
          // Track when connecting started (for timeout detection)
          const connectingSince = currentClient?.connectingSince || Date.now();
          
          this.clients.set(sessionId, {
            ...currentClient,
            socket,
            qr: null,
            status: 'connecting',
            lastUpdate: Date.now(),
            connectingSince: connectingSince, // Track when connecting started
            isLoggedOut: false
          });
          
          // Set connection timeout to prevent getting stuck
          if (!stabilityTimer) {
            stabilityTimer = setTimeout(() => {
              const client = this.clients.get(sessionId);
              if (client && client.status === 'connecting') {
                console.log(`⏱️ Connection timeout reached for ${sessionId}, marking as disconnected`);
                client.status = 'disconnected';
                client.lastUpdate = Date.now();
                
                // Attempt reconnection
                setTimeout(() => {
                  this.createClient(sessionId).catch(err => {
                    console.error(`❌ Reconnection after timeout failed: ${err.message}`);
                  });
                }, this.RECONNECT_DELAY);
              }
            }, this.CONNECTION_TIMEOUT);
          }
        }
      });

      // If we have existing credentials, set status to connecting immediately
      // This helps track connection progress and prevents stuck states
      if (hasCredentials) {
        this.clients.set(sessionId, {
          socket,
          qr: null,
          status: 'connecting',
          lastUpdate: Date.now(),
          connectingSince: Date.now(), // Track when connecting started
          isLoggedOut: false
        });
        console.log(`🔄 Restoring existing session: ${sessionId}`);
        
        // Set connection timeout for credential-based connections too
        setTimeout(() => {
          const client = this.clients.get(sessionId);
          if (client && client.status === 'connecting') {
            console.log(`⏱️ Connection timeout for restored session ${sessionId}`);
            client.status = 'disconnected';
            client.lastUpdate = Date.now();
            
            // Attempt reconnection
            setTimeout(() => {
              this.createClient(sessionId).catch(err => {
                console.error(`❌ Reconnection after timeout failed: ${err.message}`);
              });
            }, this.RECONNECT_DELAY);
          }
        }, this.CONNECTION_TIMEOUT);
      } else {
        console.log(`🆕 Fresh session - no restoration needed: ${sessionId}`);
      }

      // Handle credentials update
      socket.ev.on('creds.update', saveCreds);

      // Handle messages
      socket.ev.on('messages.upsert', async (m) => {
        try {
          console.log(`📬 messages.upsert event triggered for session: ${sessionId}`);
          console.log(`📬 Number of messages in batch: ${m.messages?.length || 0}`);
          
          const msg = m.messages[0];
          let from = msg.key.remoteJid;
          
          // Check if message has senderPn (real sender for newsletter/community messages)
          const actualSender = msg.key.senderPn || msg.key.participant || from;
          
          console.log(`📬 Message details:`, {
            remoteJid: from,
            actualSender: actualSender,
            fromMe: msg.key.fromMe,
            type: m.type,
            hasMessage: !!msg.message,
            messageKeys: msg.message ? Object.keys(msg.message) : []
          });
          
          // Filter out empty messages (deleted/failed decryption/protocol messages)
          if (!msg.message || Object.keys(msg.message).length === 0) {
            console.log(`🚫 Ignoring empty/deleted message from: ${from}`);
            return;
          }
          
          // Filter out protocol messages (WhatsApp system messages)
          if (msg.message?.protocolMessage) {
            console.log(`🚫 Ignoring protocol/system message from: ${from}`);
            return;
          }
          
          // If message is from newsletter/list but has real senderPn, use that instead
          if (from && from.includes('@lid') && actualSender && !actualSender.includes('@lid')) {
            console.log(`📧 Newsletter/List message detected, using actual sender: ${actualSender}`);
            from = actualSender; // Use real sender instead of newsletter ID
          }
          
          // Filter out broadcast/status messages (but allow @lid with valid senderPn)
          if (from && (from.includes('@broadcast') || 
                       from.includes('status@') || 
                       from.includes('@newsletter'))) {
            console.log(`🚫 Ignoring broadcast/status message from: ${from}`);
            return;
          }
          
          // Filter out @lid messages that don't have a real sender
          if (from && from.includes('@lid')) {
            console.log(`🚫 Ignoring newsletter/list message without valid sender from: ${from}`);
            console.log(`🔍 Full message key:`, JSON.stringify(msg.key, null, 2));
            return;
          }
          
          console.log(`📨 Message received from ${from}, timestamp: ${msg.messageTimestamp}, type: ${m.type}`);
          
          // Filter: Ignore messages from self (outbound messages)
          if (msg.key.fromMe) {
            console.log(`🚫 Ignoring outbound message (fromMe = true) from: ${from}`);
            return;
          }
          
          // Filter: Only process 'notify' type messages (incoming messages)
          if (m.type !== 'notify') {
            console.log(`🚫 Ignoring non-notify message type: ${m.type} from: ${from}`);
            return;
          }
          
          // Process incoming messages (fromMe = false, type = notify)
          {
            // Only process messages received after connection is established
            const connectionTime = this.clients.get(sessionId)?.connectedAt;
            if (connectionTime) {
              // Handle timestamp comparison - WhatsApp timestamps can be in different formats
              let messageTimeMs;
              
              if (typeof msg.messageTimestamp === 'number') {
                // If timestamp is already in milliseconds (large number)
                if (msg.messageTimestamp > 1000000000000) {
                  messageTimeMs = msg.messageTimestamp;
                } else {
                  // If timestamp is in seconds (smaller number)
                  messageTimeMs = msg.messageTimestamp * 1000;
                }
              } else {
                // Handle Long object format
                messageTimeMs = msg.messageTimestamp.low * 1000;
              }
              
              const connectionTimeMs = connectionTime;
              
              console.log(`⏰ Message time: ${messageTimeMs}, Connection time: ${connectionTimeMs}`);
              console.log(`⏰ Time difference: ${(messageTimeMs - connectionTimeMs) / 1000} seconds`);
              
              if (messageTimeMs < connectionTimeMs) {
                console.log(`🚫 Ignoring old message received before connection: ${messageTimeMs} < ${connectionTimeMs}`);
                console.log(`🚫 Message is ${(connectionTimeMs - messageTimeMs) / 1000} seconds too old`);
                return;
              }
            }
            
            console.log(`✅ Processing message from ${from}`);
            // Detect message type and content
            let messageText = '';
            let messageType = 'text';
            let mediaUrl = null;
            let mediaMessage = null;
            
            if (msg.message?.conversation) {
              messageText = msg.message.conversation;
              messageType = 'text';
            } else if (msg.message?.extendedTextMessage?.text) {
              messageText = msg.message.extendedTextMessage.text;
              messageType = 'text';
            } else if (msg.message?.imageMessage) {
              messageText = msg.message.imageMessage.caption || '🖼️ Image';
              messageType = 'image';
              mediaUrl = msg.message.imageMessage.url || msg.message.imageMessage.directPath;
            } else if (msg.message?.videoMessage) {
              messageText = msg.message.videoMessage.caption || '🎥 Video';
              messageType = 'video';
              mediaUrl = msg.message.videoMessage.url || msg.message.videoMessage.directPath;
            } else if (msg.message?.audioMessage) {
              messageText = '🎵 Voice Note';
              messageType = 'voice';
              // Store the message object for decryption in webhook
              mediaUrl = 'ENCRYPTED_MEDIA'; // Flag for encrypted media
              mediaMessage = msg; // Store full message for decryption
            } else if (msg.message?.documentMessage) {
              messageText = msg.message.documentMessage.fileName || '📄 Document';
              messageType = 'document';
              mediaUrl = msg.message.documentMessage.url || msg.message.documentMessage.directPath;
            } else if (msg.message?.stickerMessage) {
              messageText = '😊 Sticker';
              messageType = 'sticker';
              mediaUrl = msg.message.stickerMessage.url || msg.message.stickerMessage.directPath;
            } else {
              messageText = '📎 Media/Other';
              messageType = 'other';
            }
            
            console.log(`📨 Received message from ${from}: ${messageText}`);
            console.log(`📨 Message details:`, {
              from,
              messageText,
              messageType,
              mediaUrl,
              sessionId,
              timestamp: msg.messageTimestamp
            });
            
            // Forward to GHL webhook
            try {
              const webhookUrl = `${process.env.BACKEND_URL || 'https://api.octendr.com'}/whatsapp/webhook`;
              console.log(`🔗 Calling webhook: ${webhookUrl}`);
              
              const webhookResponse = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  from,
                  message: messageText,
                  messageType,
                  mediaUrl,
                  mediaMessage: mediaMessage, // Include full message for decryption
                  timestamp: msg.messageTimestamp,
                  sessionId,
                  whatsappMsgId: msg.key.id // For idempotency
                })
              });
              
              if (webhookResponse.ok) {
                const responseText = await webhookResponse.text();
                console.log(`✅ Message forwarded to GHL webhook for session: ${sessionId}`);
                console.log(`📊 Webhook response:`, responseText);
              } else {
                const errorText = await webhookResponse.text();
                console.error(`❌ Failed to forward message to GHL webhook (${webhookResponse.status}):`, errorText);
              }
            } catch (webhookError) {
              console.error(`❌ Error forwarding message to GHL webhook:`, webhookError);
            }
          }
        } catch (error) {
          console.error(`❌ Error processing incoming message:`, error);
        }
      });

      return socket;

    } catch (error) {
      // Handle timeout errors gracefully - don't crash server
      const errorMessage = error.message || error.toString() || '';
      const isTimeout = errorMessage.includes('Timed Out') || 
                       errorMessage.includes('timeout') || 
                       errorMessage.includes('Request Time-out') ||
                       (error.output && error.output.statusCode === 408);
      
      if (isTimeout) {
        console.warn(`⏱️ [${sessionId}] Connection timeout during client creation - this is recoverable`);
        // Mark as disconnected so retry logic can handle it
        this.clients.set(sessionId, {
          socket: null,
          qr: null,
          status: 'disconnected',
          lastUpdate: Date.now(),
          isLoggedOut: false
        });
        // Return null instead of throwing to prevent unhandled rejection
        return null;
      }
      
      // For other errors, log and throw
      console.error(`❌ Error creating Baileys client for session ${sessionId}:`, error);
      throw error;
    }
  }

  async getQRCode(sessionId) {
    try {
      let client = this.clients.get(sessionId);
      
      // Check if QR is expired (5 minutes old)
      if (client && client.qrGeneratedAt) {
        const qrAge = Date.now() - client.qrGeneratedAt;
        const QR_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
        
        if (qrAge > QR_EXPIRY_TIME) {
          console.log(`⏰ QR code expired for ${sessionId} (${Math.round(qrAge/1000)}s old). Regenerating...`);
          
          // Disconnect old client and clear session
          await this.disconnectClient(sessionId);
          this.clearSessionData(sessionId);
          
          // Wait a bit before creating new client
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Create fresh client
          await this.createClient(sessionId);
          await new Promise(resolve => setTimeout(resolve, 2000));
          client = this.clients.get(sessionId);
          
          console.log(`✨ Fresh QR code generated for session: ${sessionId}`);
        }
      }
      
      if (!client) {
        console.log(`🔄 No client found for ${sessionId}, creating new one...`);
        await this.createClient(sessionId);
        // Wait a bit for client to initialize
        await new Promise(resolve => setTimeout(resolve, 1000)); // Quick wait
        client = this.clients.get(sessionId);
      }

      if (client && client.qr) {
        const qrAge = client.qrGeneratedAt ? Math.round((Date.now() - client.qrGeneratedAt) / 1000) : 0;
        console.log(`📱 Returning QR code for session: ${sessionId} (age: ${qrAge}s)`);
        return client.qr;
      }

      console.log(`⏳ No QR code available yet for session: ${sessionId}, status: ${client?.status}, hasQR: ${!!client?.qr}`);
      return null;
    } catch (error) {
      console.error(`❌ Error getting QR code for session ${sessionId}:`, error);
      return null;
    }
  }

  async checkWhatsAppNumber(sessionId, phoneNumber) {
    try {
      const client = this.clients.get(sessionId);
      
      if (!client || !client.socket) {
        return { exists: false, error: 'Client not available' };
      }

      const formattedNumber = phoneNumber.replace(/\D/g, '');
      const jid = `${formattedNumber}@s.whatsapp.net`;

      // Check if number has WhatsApp
      const [result] = await client.socket.onWhatsApp(jid);
      
      if (result && result.exists) {
        console.log(`✅ WhatsApp exists for: ${phoneNumber}`);
        return { exists: true, jid: result.jid };
      } else {
        console.log(`❌ WhatsApp NOT found for: ${phoneNumber}`);
        return { exists: false, error: 'Number does not have WhatsApp' };
      }
      
    } catch (error) {
      console.error(`❌ Error checking WhatsApp for ${phoneNumber}:`, error.message);
      return { exists: false, error: error.message };
    }
  }

  async sendMessage(sessionId, phoneNumber, message, messageType = 'text', mediaUrl = null, fileName = null) {
    try {
      const client = this.clients.get(sessionId);
      
      if (!client || (client.status !== 'connected' && client.status !== 'ready')) {
        throw new Error(`Client not ready for session: ${sessionId}, status: ${client?.status || 'not found'}`);
      }
      
      // Check if socket is properly initialized
      if (!client.socket || !client.socket.user) {
        throw new Error(`Socket not properly initialized for session: ${sessionId}`);
      }

      // Format phone number
      const formattedNumber = phoneNumber.replace(/\D/g, '');
      const jid = `${formattedNumber}@s.whatsapp.net`;

      // Check if number has WhatsApp
      const checkResult = await this.checkWhatsAppNumber(sessionId, phoneNumber);
      if (!checkResult.exists) {
        console.warn(`⚠️ Skipping message to ${phoneNumber}: ${checkResult.error}`);
        return {
          status: 'skipped',
          reason: 'Number does not have WhatsApp',
          phoneNumber: phoneNumber
        };
      }

      console.log(`📤 Sending ${messageType} to ${jid}: ${message}`);

      let messageContent = {};

      // Check if mediaUrl is a Buffer or string URL
      const isBuffer = Buffer.isBuffer(mediaUrl);

      if (messageType === 'image' && mediaUrl) {
        // Send image
        if (isBuffer) {
          messageContent = {
            image: mediaUrl,
            caption: message || ''
          };
          console.log(`🖼️ Sending image from buffer (${mediaUrl.length} bytes)`);
        } else {
          messageContent = {
            image: { url: mediaUrl },
            caption: message || ''
          };
          console.log(`🖼️ Sending image: ${mediaUrl}`);
        }
      } else if (messageType === 'video' && mediaUrl) {
        // Send video
        if (isBuffer) {
          messageContent = {
            video: mediaUrl,
            caption: message || ''
          };
          console.log(`🎥 Sending video from buffer (${mediaUrl.length} bytes)`);
        } else {
          messageContent = {
            video: { url: mediaUrl },
            caption: message || ''
          };
          console.log(`🎥 Sending video: ${mediaUrl}`);
        }
      } else if (messageType === 'voice' && mediaUrl) {
        // Send voice note
        if (isBuffer) {
          messageContent = {
            audio: mediaUrl,
            ptt: true, // Push to talk (voice note)
            mimetype: 'audio/ogg; codecs=opus'
          };
          console.log(`🎵 Sending voice note from buffer (${mediaUrl.length} bytes)`);
        } else {
          messageContent = {
            audio: { url: mediaUrl },
            ptt: true, // Push to talk (voice note)
            mimetype: 'audio/ogg; codecs=opus'
          };
          console.log(`🎵 Sending voice note: ${mediaUrl}`);
        }
      } else if (messageType === 'audio' && mediaUrl) {
        // Send audio file (not voice note)
        if (isBuffer) {
          messageContent = {
            audio: mediaUrl,
            mimetype: 'audio/mpeg'
          };
          console.log(`🎵 Sending audio from buffer (${mediaUrl.length} bytes)`);
        } else {
          messageContent = {
            audio: { url: mediaUrl },
            mimetype: 'audio/mpeg'
          };
          console.log(`🎵 Sending audio: ${mediaUrl}`);
        }
      } else if (messageType === 'document' && mediaUrl) {
        // Send document - use provided filename or detect from URL
        const urlString = isBuffer ? '' : String(mediaUrl);
        let docFileName = fileName || 'document.pdf';
        let mimetype = 'application/pdf';
        
        // If filename was provided as parameter, use it; otherwise try to extract from URL
        if (!fileName && urlString) {
          // Try to extract filename from URL
          const urlParts = urlString.split('/');
          const lastPart = urlParts[urlParts.length - 1];
          if (lastPart && lastPart.includes('.')) {
            docFileName = lastPart.split('?')[0]; // Remove query params
          }
        }
        
        // Detect mimetype from extension
        const ext = docFileName.split('.').pop().toLowerCase();
        const mimeMap = {
          'pdf': 'application/pdf',
          'doc': 'application/msword',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'xls': 'application/vnd.ms-excel',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'txt': 'text/plain',
          'csv': 'text/csv'
        };
        mimetype = mimeMap[ext] || 'application/octet-stream';
        
        if (isBuffer) {
          messageContent = {
            document: mediaUrl,
            mimetype: mimetype,
            fileName: docFileName
          };
          console.log(`📄 Sending document from buffer (${mediaUrl.length} bytes): ${docFileName}`);
        } else {
          messageContent = {
            document: { url: mediaUrl },
            mimetype: mimetype,
            fileName: docFileName
          };
          console.log(`📄 Sending document: ${docFileName}`);
        }
      } else if (messageType === 'sticker' && mediaUrl) {
        // Send sticker
        if (isBuffer) {
          messageContent = {
            sticker: mediaUrl
          };
          console.log(`😊 Sending sticker from buffer (${mediaUrl.length} bytes)`);
        } else {
          messageContent = {
            sticker: { url: mediaUrl }
          };
          console.log(`😊 Sending sticker: ${mediaUrl}`);
        }
      } else {
        // Send text message
        messageContent = { text: message };
      }

      const result = await client.socket.sendMessage(jid, messageContent);

      console.log(`✅ ${messageType} sent successfully:`, result);
      return result;

    } catch (error) {
      console.error(`❌ Error sending ${messageType} for session ${sessionId}:`, error);
      throw error;
    }
  }

  getClientStatus(sessionId) {
    const client = this.clients.get(sessionId);
    return client ? {
      status: client.status,
      lastUpdate: client.lastUpdate,
      hasQR: !!client.qr
    } : null;
  }

  getAllClients() {
    return Array.from(this.clients.entries()).map(([sessionId, client]) => ({
      sessionId,
      status: client.status,
      lastUpdate: client.lastUpdate,
      hasQR: !!client.qr
    }));
  }

  async disconnectClient(sessionId) {
    try {
      const client = this.clients.get(sessionId);
      if (client && client.socket) {
        console.log(`🔌 Disconnecting WhatsApp session: ${sessionId}`);
        
        // Properly logout from WhatsApp (disconnects from mobile)
        try {
          await client.socket.logout();
          console.log(`✅ Logged out from WhatsApp successfully`);
        } catch (logoutError) {
          console.warn(`⚠️ Logout error (may already be logged out): ${logoutError.message}`);
        }
        
        // End socket connection
        try {
          if (client.socket.end) {
            client.socket.end();
          }
        } catch (endError) {
          console.warn(`⚠️ Error ending socket: ${endError.message}`);
        }
        
        // Remove from clients map
        this.clients.delete(sessionId);
        console.log(`✅ Client removed from memory for session: ${sessionId}`);
      } else {
        console.log(`⚠️ No client found for session: ${sessionId}`);
      }
    } catch (error) {
      console.error(`❌ Error disconnecting client for session ${sessionId}:`, error);
      // Even if error, remove from clients map
      if (this.clients.has(sessionId)) {
        this.clients.delete(sessionId);
        console.log(`🗑️ Removed client from memory despite error`);
      }
    }
  }
  
  clearQRQueue() {
    console.log(`🗑️ Clearing QR queue (${this.qrQueue.length} items)`);
    this.qrQueue = [];
    this.isGeneratingQR = false;
  }
  
  // Update database status
  async updateDatabaseStatus(sessionId, status, phoneNumber = null) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
      
      // Extract session ID from sessionId (format: location_subaccountId_sessionId)
      const sessionIdParts = sessionId.split('_');
      const actualSessionId = sessionIdParts.slice(2).join('_'); // Get everything after location_subaccountId_
      
      console.log(`📊 Updating database status for session ${actualSessionId}: ${status}`);
      
      const updateData = { status };
      if (phoneNumber) {
        updateData.phone_number = phoneNumber;
      }
      
      const { error } = await supabaseAdmin
        .from('sessions')
        .update(updateData)
        .eq('id', actualSessionId);
      
      if (error) {
        console.error('❌ Database update error:', error);
      } else {
        console.log(`✅ Database status updated to: ${status}`);
        
        // If this session is now ready (connected), mark other sessions for same subaccount as disconnected
        if (status === 'ready') {
          await this.cleanupOldSessions(actualSessionId, sessionIdParts);
        }
      }
    } catch (error) {
      console.error('❌ Error updating database status:', error);
    }
  }

  // Send disconnect email notification
  async sendDisconnectEmail(sessionId, reason = 'mobile', details = null) {
    try {
      // Extract session ID from sessionId (format: location_subaccountId_sessionId)
      const sessionIdParts = sessionId.split('_');
      const actualSessionId = sessionIdParts.length >= 3 ? sessionIdParts.slice(2).join('_') : sessionId;
      
      // Get session from database to get user_id and subaccount_id
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
      
      const { data: session } = await supabaseAdmin
        .from('sessions')
        .select('user_id, subaccount_id')
        .eq('id', actualSessionId)
        .maybeSingle();
      
      if (!session) {
        console.log(`⚠️ Session not found for email notification: ${actualSessionId}`);
        return;
      }
      
      // Get GHL account to get location_id
      const { data: ghlAccount } = await supabaseAdmin
        .from('ghl_accounts')
        .select('location_id')
        .eq('id', session.subaccount_id)
        .maybeSingle();
      
      if (!ghlAccount) {
        console.log(`⚠️ GHL account not found for email notification`);
        return;
      }
      
      // Send email notification with details for system disconnections
      await emailService.sendDisconnectNotification(
        session.user_id,
        ghlAccount.location_id,
        reason,
        details // Pass disconnect details (reason, code, timestamp, etc.)
      );
      
    } catch (error) {
      console.error(`❌ Error sending disconnect email:`, error);
    }
  }
  
  // Cleanup old sessions for same subaccount
  async cleanupOldSessions(currentSessionId, sessionIdParts) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
      
      // Extract subaccount ID from sessionIdParts
      const subaccountId = sessionIdParts[1]; // location_subaccountId_sessionId
      
      console.log(`🧹 Cleaning up old sessions for subaccount: ${subaccountId}`);
      
      // Mark other sessions for same subaccount as disconnected
      const { error } = await supabaseAdmin
        .from('sessions')
        .update({ status: 'disconnected' })
        .eq('subaccount_id', subaccountId)
        .neq('id', currentSessionId)
        .neq('status', 'disconnected');
      
      if (error) {
        console.error('❌ Cleanup error:', error);
      } else {
        console.log(`✅ Old sessions marked as disconnected for subaccount: ${subaccountId}`);
      }
      
      // Also cleanup disconnected clients from memory
      this.clients.forEach((client, sessionKey) => {
        if (sessionKey.includes(subaccountId) && sessionKey !== `location_${subaccountId}_${currentSessionId}`) {
          if (client.status === 'disconnected' || client.status === 'qr_ready' || client.status === 'connecting') {
            console.log(`🗑️ Removing old client from memory: ${sessionKey} (status: ${client.status})`);
            this.clients.delete(sessionKey);
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Error cleaning up old sessions:', error);
    }
  }

  /**
   * Get WhatsApp Web version info
   * Returns current version information (cached or latest)
   */
  async getWhatsAppVersion() {
    try {
      // Try to fetch latest version info
      const { version, isLatest } = await fetchLatestBaileysVersion();
      return {
        version: version.join('.'),
        versionArray: version,
        isLatest: isLatest,
        status: isLatest ? 'Latest version' : 'Using cached version',
        source: 'Baileys fetchLatestBaileysVersion',
        lastUpdated: new Date().toISOString(),
        pairingCodeSupported: false
      };
    } catch (error) {
      // Fallback if fetch fails
      return {
        version: '2.3000.1025190524',
        versionArray: [2, 3000, 1025190524],
        isLatest: false,
        status: 'Fallback version (fetch failed)',
        source: 'Fallback',
        lastUpdated: new Date().toISOString(),
        pairingCodeSupported: false,
        error: error.message
      };
    }
  }
}

module.exports = BaileysWhatsAppManager;
