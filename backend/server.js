// Suppress Node.js deprecation warnings from dependencies
// These warnings come from third-party packages (like Baileys) and don't affect functionality
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  // Only suppress DEP0169 (url.parse deprecation) - allow other warnings
  if (warning.name === 'DeprecationWarning' && warning.message.includes('url.parse()')) {
    return; // Suppress this specific warning
  }
  // Log other warnings normally
  console.warn(warning.name, warning.message);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');
const GHLClient = require('./lib/ghl');
const qrcode = require('qrcode');
const { processWhatsAppMedia } = require('./mediaHandler');
const axios = require('axios');
const Stripe = require('stripe');
// Import Baileys functions for media decryption
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
// Import subaccount helpers
const subaccountHelpers = require('./lib/subaccount-helpers');
// Import drip queue processor (already instantiated)
const dripQueueProcessor = require('./lib/drip-queue-processor');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// GHL configuration
const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;
const GHL_REDIRECT_URI = process.env.GHL_REDIRECT_URI;
const GHL_SCOPES = process.env.GHL_SCOPES || 'locations.readonly conversations.write conversations.readonly conversations/message.readonly conversations/message.write contacts.readonly contacts.write businesses.readonly users.readonly medias.write';

// Stripe configuration
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
}) : null;
const STRIPE_STARTER_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID;
const STRIPE_PROFESSIONAL_PRICE_ID = process.env.STRIPE_PROFESSIONAL_PRICE_ID;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Token refresh function
async function refreshGHLToken(ghlAccount) {
  try {
    console.log(`🔄 Refreshing token for GHL account: ${ghlAccount.id}`);
    console.log(`🔑 Using refresh token: ${ghlAccount.refresh_token ? 'Present' : 'Missing'}`);
    console.log(`🔑 Client ID: ${GHL_CLIENT_ID ? 'Present' : 'Missing'}`);
    console.log(`🔑 Client Secret: ${GHL_CLIENT_SECRET ? 'Present' : 'Missing'}`);
    
    if (!ghlAccount.refresh_token) {
      throw new Error('No refresh token available');
    }
    
    if (!GHL_CLIENT_ID || !GHL_CLIENT_SECRET) {
      throw new Error('GHL client credentials not configured');
    }
    
    // GHL OAuth requires form-urlencoded format
    const formData = new URLSearchParams();
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', ghlAccount.refresh_token);
    formData.append('client_id', GHL_CLIENT_ID);
    formData.append('client_secret', GHL_CLIENT_SECRET);

    const response = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });

    console.log(`📊 Token refresh response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Token refresh failed: ${response.status} - ${errorText}`);
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();
    console.log(`✅ Token refresh successful, expires in: ${tokenData.expires_in} seconds`);
    
    const expiryTimestamp = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
    // Update token in database
    const { error } = await supabaseAdmin
      .from('ghl_accounts')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiryTimestamp,  // Old column
        token_expires_at: expiryTimestamp  // New column
      })
      .eq('id', ghlAccount.id);

    if (error) {
      console.error(`❌ Database update failed:`, error);
      throw new Error(`Database update failed: ${error.message}`);
    }

    console.log(`✅ Token refreshed and saved successfully for GHL account: ${ghlAccount.id}`);
    return tokenData.access_token;
    
  } catch (error) {
    console.error(`❌ Token refresh failed for GHL account ${ghlAccount.id}:`, error);
    throw error;
  }
}

// Helper function for media message text
function getMediaMessageText(messageType) {
  const messages = {
    'image': '🖼️ Image received',
    'voice': '🎵 Voice note received',
    'audio': '🎵 Audio file received',
    'video': '🎥 Video received',
    'document': '📄 Document received'
  };
  return messages[messageType] || '📎 Media received';
}

// Helper function to get media file extension
function getMediaExtension(messageType) {
  switch (messageType) {
    case 'image': return 'jpg';
    case 'voice': return 'ogg';
    case 'video': return 'mp4';
    case 'audio': return 'mp3';
    case 'document': return 'pdf';
    default: return 'bin';
  }
}

// Check and refresh token if needed
async function ensureValidToken(ghlAccount, forceRefresh = false) {
  try {
    if (forceRefresh) {
      console.log(`🔄 Force refreshing token for GHL account ${ghlAccount.id}`);
      return await refreshGHLToken(ghlAccount);
    }
    
    // Check if token is expired or about to expire (within 1 hour)
    if (ghlAccount.token_expires_at) {
      const now = new Date();
      const expiresAt = new Date(ghlAccount.token_expires_at);
      const oneHourFromNow = new Date(now.getTime() + (60 * 60 * 1000));
      
      if (expiresAt <= oneHourFromNow) {
        console.log(`🔄 Token expired or expiring soon for GHL account ${ghlAccount.id} (expires at: ${expiresAt.toISOString()})`);
        return await refreshGHLToken(ghlAccount);
      }
    }
    
    console.log(`✅ Using valid token for GHL account ${ghlAccount.id} (expires: ${ghlAccount.token_expires_at})`);
    return ghlAccount.access_token;
  } catch (error) {
    console.error(`❌ Token validation failed for GHL account ${ghlAccount.id}:`, error);
    console.error(`❌ Falling back to stored token (may be expired)`);
    return ghlAccount.access_token; // Return stored token even if expired, let GHL API handle the error
  }
}

// Helper function to make GHL API calls with automatic token refresh on 401
async function makeGHLRequest(url, options, ghlAccount, retryCount = 0) {
  const MAX_RETRIES = 1;
  
  try {
    const response = await fetch(url, options);
    
    // If 401 and we haven't retried yet, refresh token and retry
    if (response.status === 401 && retryCount < MAX_RETRIES) {
      console.log(`🔄 Got 401 error, refreshing token and retrying... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      // Refresh token
      const newToken = await refreshGHLToken(ghlAccount);
      
      // Update authorization header with new token
      options.headers.Authorization = `Bearer ${newToken}`;
      
      // Fetch updated ghl account data from database to ensure consistency
      const { data: updatedAccount } = await supabaseAdmin
        .from('ghl_accounts')
        .select('*')
        .eq('id', ghlAccount.id)
        .single();
      
      if (updatedAccount) {
        console.log(`✅ Using refreshed token from database (expires: ${updatedAccount.token_expires_at})`);
      }
      
      // Retry the request
      return await makeGHLRequest(url, options, updatedAccount || ghlAccount, retryCount + 1);
    }
    
    return response;
  } catch (error) {
    console.error(`❌ Request failed:`, error);
    throw error;
  }
}

// WhatsApp Manager (Baileys)
const BaileysWhatsAppManager = require('./lib/baileys-wa');
const waManager = new BaileysWhatsAppManager();

// Password utilities
const { hashPassword, verifyPassword, generateOTP } = require('./lib/password');
const emailService = require('./lib/email');

// Scheduled token refresh (every 6 hours - more frequent for 24-hour tokens)
setInterval(async () => {
  try {
    console.log('🔄 Running scheduled token refresh...');
    
    const { data: ghlAccounts } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .not('refresh_token', 'is', null);

    if (!ghlAccounts || ghlAccounts.length === 0) {
      console.log('📋 No GHL accounts found for token refresh');
      return;
    }

    console.log(`📋 Found ${ghlAccounts.length} GHL accounts to check for token refresh`);

    for (const account of ghlAccounts) {
      try {
        await ensureValidToken(account);
        console.log(`✅ Token check completed for GHL account: ${account.id}`);
      } catch (error) {
        console.error(`❌ Token refresh failed for GHL account ${account.id}:`, error);
      }
    }
    
    console.log('✅ Scheduled token refresh completed');
  } catch (error) {
    console.error('❌ Scheduled token refresh error:', error);
  }
}, 6 * 60 * 60 * 1000); // Every 6 hours

// Additional aggressive token refresh (every 2 hours for critical accounts)
setInterval(async () => {
  try {
    console.log('🔄 Running aggressive token refresh...');
    
    const { data: ghlAccounts } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .not('refresh_token', 'is', null);

    if (!ghlAccounts || ghlAccounts.length === 0) {
      return;
    }

    for (const account of ghlAccounts) {
      try {
        // Check if token expires within 8 hours
        const now = new Date();
        const expiresAt = new Date(account.token_expires_at);
        const eightHoursFromNow = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        
        if (expiresAt <= eightHoursFromNow) {
          console.log(`🔄 Aggressive refresh for account ${account.id} (expires in ${Math.round((expiresAt - now) / (60 * 60 * 1000))} hours)`);
          await refreshGHLToken(account);
        }
      } catch (error) {
        console.error(`❌ Aggressive token refresh failed for GHL account ${account.id}:`, error);
      }
    }
  } catch (error) {
    console.error('❌ Aggressive token refresh error:', error);
  }
}, 2 * 60 * 60 * 1000); // Every 2 hours

// Restore WhatsApp clients from database on startup
async function restoreWhatsAppClients() {
  try {
    console.log('🔄 Restoring WhatsApp clients from database...');
    
    const { data: sessions, error } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('status', 'ready')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching sessions:', error);
      return;
    }

    if (!sessions || sessions.length === 0) {
      console.log('📋 No active WhatsApp sessions found in database');
      return;
    }

    console.log(`📋 Found ${sessions.length} active sessions to restore`);

    for (const session of sessions) {
      try {
        const cleanSubaccountId = session.subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sessionName = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        
        console.log(`🔄 Restoring client for session: ${sessionName}`);
        await waManager.createClient(sessionName);
        
        // Wait a bit for client to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const status = waManager.getClientStatus(sessionName);
        console.log(`📊 Client status for ${sessionName}:`, status?.status);
        
      } catch (error) {
        console.error(`❌ Error restoring client for session ${session.id}:`, error);
      }
    }

    console.log('✅ WhatsApp client restoration completed');
    console.log('📊 Active clients:', waManager.getAllClients().map(c => c.sessionId));
    
  } catch (error) {
    console.error('❌ Error in client restoration:', error);
  }
}

// Restore clients after a short delay
setTimeout(restoreWhatsAppClients, 3000);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://services.leadconnectorhq.com"],
      frameSrc: ["'self'", "https://app.gohighlevel.com", "https://*.gohighlevel.com"],
      // Permanent solution for whitelabel domains - Allow all origins (required for GHL whitelabel functionality)
      frameAncestors: ["*"]
    }
  },
  // Disable X-Frame-Options since we're setting it manually for whitelabel support
  frameguard: false
}));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://api.octendr.com',
      'https://whatsapp123-frontend.vercel.app',
      'https://whatsappghl.vercel.app',
      'https://whatsappgh1.vercel.app',
      'https://whatsapghl.vercel.app',
      'https://whatsanghl.vercel.app',
      'https://app.gohighlevel.com',
      'https://dashboard.octendr.com',
      'https://api.octendr.com'
    ];
    
    // Check if origin is in allowed list OR matches pattern
    const isAllowed = allowedOrigins.includes(origin) || 
                      origin.endsWith('.vercel.app') || 
                      origin.endsWith('.onrender.com') ||
                      origin.endsWith('.gohighlevel.com') ||
                      origin.endsWith('.octendr.com');
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'X-User-ID'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours
}));

// Add CSP headers for iframe embedding
app.use((req, res, next) => {
  // Allow iframe embedding from GHL domains
  // Permanent solution for whitelabel domains - Allow all origins (required for GHL whitelabel functionality)
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  // CORS headers are handled by cors() middleware above, don't override them here
  // res.setHeader('Access-Control-Allow-Origin', '*');
  // res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  next();
});

// Stripe Webhook Handler - MUST be before express.json() to receive raw body
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) {
      console.error('❌ Stripe not configured');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const signature = req.headers['stripe-signature'];
    const webhookSecret = STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      console.error('❌ Missing Stripe signature or webhook secret');
      return res.status(400).json({ error: 'Missing signature or webhook secret' });
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    console.log(`📨 Stripe webhook received: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        
        const userId = session.metadata?.user_id;
        const planType = session.metadata?.plan_type; // 'starter' or 'professional'
        const paymentType = session.metadata?.payment_type || 'recurring'; // 'recurring' or 'one-time'
        const isAdditionalSubaccount = session.metadata?.additional_subaccount === 'true';

        // Handle additional subaccount purchase
        if (isAdditionalSubaccount && userId) {
          const currentMax = parseInt(session.metadata?.current_max || '0');
          
          // Get current user info
          const { data: userInfo } = await supabaseAdmin
            .from('users')
            .select('max_subaccounts, subscription_status')
            .eq('id', userId)
            .single();

          if (userInfo && userInfo.subscription_status === 'active') {
            // Increment max_subaccounts by 1
            const newMax = (userInfo.max_subaccounts || currentMax) + 1;
            
            const { error: updateError } = await supabaseAdmin
              .from('users')
              .update({ max_subaccounts: newMax })
              .eq('id', userId);

            if (updateError) {
              console.error('❌ Error updating max_subaccounts for additional subaccount:', updateError);
            } else {
              console.log(`✅ Additional subaccount purchased. User ${userId} max_subaccounts updated from ${userInfo.max_subaccounts} to ${newMax}`);
              
              // Log the event
              await supabaseAdmin.from('subscription_events').insert({
                user_id: userId,
                event_type: 'additional_subaccount_purchased',
                plan_name: userInfo.subscription_status,
                metadata: {
                  stripe_session_id: session.id,
                  previous_max: userInfo.max_subaccounts,
                  new_max: newMax,
                  amount: 400 // $4 in cents
                }
              });
            }
          }
          
          return res.json({ received: true });
        }

        // Regular plan purchase
        if (!userId || !planType) {
          console.error('❌ Missing user_id or plan_type in metadata');
          return res.status(400).json({ error: 'Invalid metadata' });
        }

        // Plan configuration
        const planConfig = {
          starter: { max_subaccounts: 2, price: 19 },
          professional: { max_subaccounts: 10, price: 49 }
        };

        const config = planConfig[planType];

        if (!config) {
          console.error('❌ Invalid plan type:', planType);
          return res.status(400).json({ error: 'Invalid plan type' });
        }

        // Determine subscription end date based on payment type
        let subscriptionEndsAt;
        if (paymentType === 'one-time') {
          // For one-time payments, calculate based on amount or set fixed duration
          // Example: If $19 = 1 month, $49 = 1 month (or adjust as needed)
          subscriptionEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        } else {
          // For recurring subscriptions, use subscription end date
          subscriptionEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // Will be updated by subscription.updated event
        }

        // Update user in database
        const updateData = {
          subscription_status: 'active',
          subscription_plan: planType,
          max_subaccounts: config.max_subaccounts,
          stripe_customer_id: session.customer,
          subscription_started_at: new Date().toISOString(),
          subscription_ends_at: subscriptionEndsAt
        };

        // Only add subscription_id for recurring payments
        if (paymentType === 'recurring' && session.subscription) {
          updateData.stripe_subscription_id = session.subscription;
        }

        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update(updateData)
          .eq('id', userId);

        if (updateError) {
          console.error('❌ Database update error:', updateError);
          return res.status(500).json({ error: 'Database update failed' });
        }

        console.log(`✅ User ${userId} upgraded to ${planType} plan (${paymentType})`);

        // Log subscription event
        await supabaseAdmin.from('subscription_events').insert({
          user_id: userId,
          event_type: paymentType === 'one-time' ? 'one_time_payment' : 'upgrade',
          plan_name: planType,
          metadata: { 
            stripe_session_id: session.id,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription || null,
            payment_type: paymentType,
            payment_intent_id: session.payment_intent || null
          }
        });

        // Send subscription activation email
        try {
          const emailService = require('./lib/email');
          const emailResult = await emailService.sendSubscriptionActivationEmail(userId, planType);
          if (emailResult.success) {
            console.log(`✅ Subscription activation email sent to user ${userId}`);
          } else {
            console.error(`❌ Failed to send subscription activation email:`, emailResult.error);
          }
        } catch (emailError) {
          console.error('❌ Error sending subscription activation email:', emailError);
          // Don't fail the webhook if email fails
        }

        break;
      }

      case 'payment_intent.succeeded': {
        // Handle one-time payment success (if not handled by checkout.session.completed)
        const paymentIntent = event.data.object;
        
        // Check if this payment was already handled by checkout.session.completed
        // This is a backup handler for one-time payments
        if (paymentIntent.metadata?.user_id) {
          const userId = paymentIntent.metadata.user_id;
          console.log(`✅ One-time payment succeeded for user ${userId}`);
          
          // Log payment event
          await supabaseAdmin.from('subscription_events').insert({
            user_id: userId,
            event_type: 'one_time_payment_succeeded',
            plan_name: paymentIntent.metadata.plan_type || 'unknown',
            metadata: {
              payment_intent_id: paymentIntent.id,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency
            }
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        // Find user by stripe_customer_id
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id, email, name, subscription_plan, stripe_subscription_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (user) {
          console.log(`⚠️ Payment failed for user ${user.id}`);
          
          // Check subscription status in Stripe to get accurate status
          let subscriptionStatus = 'active'; // Default
          let cancelAtPeriodEnd = false;
          if (user.stripe_subscription_id && stripe) {
            try {
              const stripeSubscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
              subscriptionStatus = stripeSubscription.status; // 'active', 'past_due', 'unpaid', 'canceled', etc.
              cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end || false;
              console.log(`📊 Stripe subscription status: ${subscriptionStatus}, cancel_at_period_end: ${cancelAtPeriodEnd}`);
              
              // Check if there are any open invoices (pending payment)
              const openInvoices = await stripe.invoices.list({
                customer: customerId,
                status: 'open',
                limit: 1
              });
              
              // If there's an open invoice, it means payment is pending, not cancelled
              if (openInvoices.data.length > 0) {
                console.log(`📄 Found ${openInvoices.data.length} open invoice(s) - payment is pending`);
                subscriptionStatus = 'past_due'; // Override to past_due if invoice is pending
              }
            } catch (stripeError) {
              console.error('❌ Error fetching Stripe subscription:', stripeError);
            }
          }

          // Update subscription status based on Stripe status
          // IMPORTANT: If invoice.payment_failed event occurred, there's a pending invoice
          // Only mark as cancelled if subscription is actually cancelled (cancel_at_period_end = true)
          // Otherwise, mark as past_due (payment pending)
          let statusUpdate = {};
          if (subscriptionStatus === 'past_due') {
            statusUpdate.subscription_status = 'past_due';
          } else if (subscriptionStatus === 'canceled' && cancelAtPeriodEnd) {
            // Only mark as cancelled if user actually cancelled (not just payment failed)
            statusUpdate.subscription_status = 'cancelled';
            statusUpdate.max_subaccounts = 1; // Reset to trial limits
          } else if (subscriptionStatus === 'unpaid') {
            // Unpaid means payment failed but subscription still exists - mark as past_due
            statusUpdate.subscription_status = 'past_due';
          } else if (subscriptionStatus === 'canceled' && !cancelAtPeriodEnd) {
            // Subscription was cancelled by Stripe (not by user) - but if there's a pending invoice, keep as past_due
            // Check if invoice exists
            statusUpdate.subscription_status = 'past_due'; // Payment pending, not actually cancelled
          } else if (subscriptionStatus === 'active') {
            // Payment failed event but subscription still active - mark as past_due
            statusUpdate.subscription_status = 'past_due';
          }

          if (Object.keys(statusUpdate).length > 0) {
            await supabaseAdmin
              .from('users')
              .update(statusUpdate)
              .eq('id', user.id);
            console.log(`✅ Updated subscription status for user ${user.id}: ${JSON.stringify(statusUpdate)}`);
          }
          
          // DISCONNECT ALL WHATSAPP SESSIONS when payment fails
          // Existing accounts remain but WhatsApp connections are disabled
          if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'canceled') {
            try {
              console.log(`🔌 Disconnecting all WhatsApp sessions for user ${user.id} due to payment failure`);
              
              // Get all GHL accounts for this user
              const { data: ghlAccounts } = await supabaseAdmin
                .from('ghl_accounts')
                .select('id, location_id')
                .eq('user_id', user.id);

              if (ghlAccounts && ghlAccounts.length > 0) {
                let disconnectedCount = 0;
                
                for (const ghlAccount of ghlAccounts) {
                  // Get all sessions for this account
                  const { data: sessions } = await supabaseAdmin
                    .from('sessions')
                    .select('id, status')
                    .eq('subaccount_id', ghlAccount.id);

                  if (sessions && sessions.length > 0) {
                    for (const session of sessions) {
                      try {
                        // Disconnect WhatsApp client
                        const sessionName = `subaccount_${ghlAccount.id}_${session.id}`;
                        await waManager.disconnectClient(sessionName);
                        waManager.clearSessionData(sessionName);
                        
                        // Update database status
                        await supabaseAdmin
                          .from('sessions')
                          .update({ status: 'disconnected' })
                          .eq('id', session.id);
                        
                        disconnectedCount++;
                        console.log(`✅ Disconnected session ${session.id} for account ${ghlAccount.id}`);
                      } catch (sessionError) {
                        console.error(`⚠️ Error disconnecting session ${session.id}:`, sessionError.message);
                        // Still update database status even if disconnect fails
                        await supabaseAdmin
                          .from('sessions')
                          .update({ status: 'disconnected' })
                          .eq('id', session.id);
                        disconnectedCount++;
                      }
                    }
                  }
                }
                
                console.log(`✅ Disconnected ${disconnectedCount} WhatsApp session(s) for user ${user.id}`);
              } else {
                console.log(`ℹ️ No GHL accounts found for user ${user.id} to disconnect`);
              }
            } catch (disconnectError) {
              console.error(`❌ Error disconnecting WhatsApp sessions:`, disconnectError);
              // Don't fail the webhook if disconnect fails
            }
          }
          
          // Log payment failure event
          await supabaseAdmin.from('subscription_events').insert({
            user_id: user.id,
            event_type: 'payment_failed',
            plan_name: user.subscription_plan || 'unknown',
            metadata: {
              invoice_id: invoice.id,
              amount_due: invoice.amount_due,
              invoice_url: invoice.hosted_invoice_url,
              subscription_status: subscriptionStatus
            }
          });

          // Send payment failed email
          try {
            const emailService = require('./lib/email');
            const emailResult = await emailService.sendPaymentFailedEmail(user.id, {
              amount_due: invoice.amount_due,
              hosted_invoice_url: invoice.hosted_invoice_url,
              invoice_pdf: invoice.invoice_pdf
            });
            if (emailResult.success) {
              console.log(`✅ Payment failed email sent to user ${user.id}`);
            } else {
              console.error(`❌ Failed to send payment failed email:`, emailResult.error);
            }
          } catch (emailError) {
            console.error('❌ Error sending payment failed email:', emailError);
            // Don't fail the webhook if email fails
          }
        }

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;

        // Find user by subscription ID
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id, subscription_plan')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();

        if (!user) {
          console.log(`⚠️ No user found for subscription ${subscription.id}`);
          break;
        }

        // Determine plan from Stripe subscription items
        let planType = user.subscription_plan; // Default to existing plan
        let maxSubaccounts = 1; // Default to trial
        
        if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
          const priceId = subscription.items.data[0].price.id;
          // Check if it's a known plan price ID (you may need to adjust these based on your Stripe price IDs)
          // For now, we'll use metadata or price amount to determine plan
          const priceAmount = subscription.items.data[0].price.unit_amount;
          
          // Determine plan based on price (adjust these amounts based on your actual Stripe prices)
          if (priceAmount === 1900) { // $19.00 = Starter
            planType = 'starter';
            maxSubaccounts = 2;
          } else if (priceAmount === 4900) { // $49.00 = Professional
            planType = 'professional';
            maxSubaccounts = 10;
          }
          
          // Also check metadata if available
          if (subscription.items.data[0].price.metadata?.plan_type) {
            planType = subscription.items.data[0].price.metadata.plan_type;
            maxSubaccounts = planType === 'starter' ? 2 : planType === 'professional' ? 10 : 1;
          }
        }

        // Update subscription end date and plan
        let statusUpdate = {
          subscription_ends_at: subscription.current_period_end 
            ? new Date(subscription.current_period_end * 1000).toISOString() 
            : null
        };

        // Update plan and max_subaccounts if plan changed
        if (planType && planType !== user.subscription_plan) {
          statusUpdate.subscription_plan = planType;
          statusUpdate.max_subaccounts = maxSubaccounts;
          console.log(`✅ Plan updated for user ${user.id}: ${user.subscription_plan} → ${planType} (max_subaccounts: ${maxSubaccounts})`);
        } else if (subscription.status === 'active' && !subscription.cancel_at_period_end) {
          // If subscription is active, ensure max_subaccounts matches the plan
          statusUpdate.max_subaccounts = maxSubaccounts;
        }

        // Handle subscription status changes
        let shouldLogEvent = false;
        let eventType = 'subscription_updated';

        if (subscription.status === 'active' && subscription.cancel_at_period_end === false) {
          // Subscription reactivated - restore plan limits
          statusUpdate.subscription_status = 'active';
          statusUpdate.max_subaccounts = maxSubaccounts; // Restore based on plan
          eventType = 'subscription_reactivated';
          shouldLogEvent = true;
        } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
          // Subscription cancelled or unpaid
          statusUpdate.subscription_status = 'cancelled';
          statusUpdate.max_subaccounts = 1; // Reset to trial limits
          eventType = 'subscription_cancelled';
          shouldLogEvent = true;
        } else if (subscription.cancel_at_period_end === true && subscription.status === 'active') {
          // Cancellation scheduled (user cancelled but still has access)
          statusUpdate.subscription_status = 'cancelled'; // Mark as cancelled but keep access
          // Keep max_subaccounts as is (user still has access until period end)
          eventType = 'subscription_cancellation_scheduled';
          shouldLogEvent = true;
        } else if (subscription.status === 'past_due') {
          // Payment failed - block account creation but keep plan limits
          statusUpdate.subscription_status = 'past_due';
          // Keep max_subaccounts (user still has plan, just payment pending)
          eventType = 'subscription_past_due';
          shouldLogEvent = true;
        } else if (subscription.status === 'incomplete' || subscription.status === 'incomplete_expired') {
          // Payment incomplete - treat as past_due
          statusUpdate.subscription_status = 'past_due';
          eventType = 'subscription_payment_incomplete';
          shouldLogEvent = true;
        }

        // Update user in database
        await supabaseAdmin
          .from('users')
          .update(statusUpdate)
          .eq('id', user.id);

        console.log(`✅ Updated subscription for user ${user.id}: ${JSON.stringify(statusUpdate)}`);

        // Log event
        if (shouldLogEvent) {
          await supabaseAdmin.from('subscription_events').insert({
            user_id: user.id,
            event_type: eventType,
            plan_name: user.subscription_plan || 'unknown',
            metadata: {
              stripe_subscription_id: subscription.id,
              status: subscription.status,
              cancel_at_period_end: subscription.cancel_at_period_end,
              current_period_end: subscription.current_period_end,
              current_period_start: subscription.current_period_start
            }
          });
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id, subscription_plan')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();

        if (user) {
          // Subscription fully cancelled - access revoked
          await supabaseAdmin
            .from('users')
            .update({
              subscription_status: 'expired',
              max_subaccounts: 1,
              stripe_subscription_id: null
            })
            .eq('id', user.id);

          // Log event
          await supabaseAdmin.from('subscription_events').insert({
            user_id: user.id,
            event_type: 'subscription_deleted',
            plan_name: user.subscription_plan || 'unknown',
            metadata: {
              stripe_subscription_id: subscription.id,
              deleted_at: new Date().toISOString()
            }
          });

          console.log(`⚠️ Subscription deleted for user ${user.id}. Access revoked.`);
        }

        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;

        // Find user by stripe_customer_id
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id, email, name, subscription_plan, stripe_subscription_id, subscription_status')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (user && subscriptionId) {
          console.log(`✅ Payment succeeded for user ${user.id}`);
          
          // Update subscription status to active if it was past_due or cancelled
          if (user.subscription_status === 'past_due' || user.subscription_status === 'cancelled') {
            try {
              // Get subscription from Stripe to verify status
              const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
              
              if (stripeSubscription.status === 'active') {
                await supabaseAdmin
                  .from('users')
                  .update({
                    subscription_status: 'active'
                  })
                  .eq('id', user.id);
                
                console.log(`✅ Reactivated subscription for user ${user.id} after payment`);
                
                // Log payment success event
                await supabaseAdmin.from('subscription_events').insert({
                  user_id: user.id,
                  event_type: 'payment_succeeded_reactivation',
                  plan_name: user.subscription_plan || 'unknown',
                  metadata: {
                    invoice_id: invoice.id,
                    subscription_id: subscriptionId,
                    old_status: user.subscription_status,
                    new_status: 'active'
                  }
                });
              }
            } catch (stripeError) {
              console.error('❌ Error verifying subscription status:', stripeError);
            }
          } else {
            // Log payment success event (for active subscriptions)
            await supabaseAdmin.from('subscription_events').insert({
              user_id: user.id,
              event_type: 'payment_succeeded',
              plan_name: user.subscription_plan || 'unknown',
              metadata: {
                invoice_id: invoice.id,
                subscription_id: subscriptionId
              }
            });
          }
        }
        break;
      }

      case 'invoice.payment_succeeded_OLD': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        // Find user and update subscription status
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id, subscription_plan')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (user) {
          await supabaseAdmin
            .from('users')
            .update({
              subscription_status: 'active'
            })
            .eq('id', user.id);

          // Log payment success event
          await supabaseAdmin.from('subscription_events').insert({
            user_id: user.id,
            event_type: 'payment_succeeded',
            plan_name: user.subscription_plan || 'unknown',
            metadata: {
              invoice_id: invoice.id,
              amount_paid: invoice.amount_paid,
              currency: invoice.currency,
              period_start: invoice.period_start,
              period_end: invoice.period_end
            }
          });

          console.log(`✅ Payment succeeded for user ${user.id}`);
        }

        break;
      }

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.use(express.json());
app.use(cookieParser()); // Parse cookies from requests

// Handle preflight requests - CORS middleware handles this automatically
// but we add this for extra safety
app.options('*', cors());

// Auth middleware - JWT based (supports both cookie and header-based auth)
const requireAuth = async (req, res, next) => {
  try {
    let userId = null;
    
    // Method 1: Try to get JWT from cookie (for same-domain requests)
    const token = req.cookies?.auth_token;
    
    if (token) {
      try {
        // Verify JWT
        const jwt = require('jsonwebtoken');
        const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
        
        const decoded = jwt.verify(token, jwtSecret);
        
        if (decoded && decoded.userId) {
          userId = decoded.userId;
          req.user = {
            id: decoded.userId,
            email: decoded.email,
            name: decoded.name
          };
          return next();
        }
      } catch (jwtError) {
        // Token invalid, try alternative auth method
      }
    }
    
    // Method 2: Try to get user ID from header (for cross-domain requests)
    const headerUserId = req.headers['x-user-id'];
    
    if (headerUserId) {
      // Verify user exists in database
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('id', headerUserId)
        .maybeSingle();
      
      if (!userError && user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name
        };
        return next();
      }
    }
    
    // If both methods failed
    if (!userId && !headerUserId) {
      return res.status(401).json({ error: 'No authentication token provided. Please login again.' });
    }
    
    return res.status(401).json({ error: 'Authentication failed' });
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Health check
// Health check endpoints for monitoring
app.get('/api/health/database', requireAuth, async (req, res) => {
  try {
    // Test database connection
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      return res.status(500).json({
        connected: false,
        message: `Database connection failed: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }

    return res.json({
      connected: true,
      message: 'Database connection is healthy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      connected: false,
      message: `Database check failed: ${error.message}`
    });
  }
});

app.get('/api/health/whatsapp', requireAuth, async (req, res) => {
  try {
    const clients = waManager.getAllClients();
    const connectedClients = clients.filter(c => c.status === 'connected' || c.status === 'ready');
    
    return res.json({
      status: 'operational',
      message: `WhatsApp service is operational. ${connectedClients.length} active client(s)`,
      totalClients: clients.length,
      connectedClients: connectedClients.length,
      clients: clients.map(c => ({
        sessionId: c.sessionId,
        status: c.status,
        phoneNumber: c.phoneNumber || 'N/A'
      }))
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: `WhatsApp service check failed: ${error.message}`
    });
  }
});

app.get('/api/health/ghl', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if user has GHL accounts
    const { data: ghlAccounts, error } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id, location_id, expires_at, token_expires_at')
      .eq('user_id', userId)
      .limit(5);

    if (error) {
      return res.status(500).json({
        connected: false,
        message: `GHL integration check failed: ${error.message}`
      });
    }

    const hasValidTokens = ghlAccounts && ghlAccounts.length > 0;
    
    return res.json({
      connected: hasValidTokens,
      message: hasValidTokens 
        ? `GHL integration is configured. ${ghlAccounts.length} account(s) connected`
        : 'GHL integration not configured. Please connect a GHL account.',
      accountCount: ghlAccounts?.length || 0,
      accounts: ghlAccounts || []
    });
  } catch (error) {
    return res.status(500).json({
      connected: false,
      message: `GHL integration check failed: ${error.message}`
    });
  }
});

app.get('/api/health/qr', requireAuth, async (req, res) => {
  try {
    // Test QR code generation
    const testQR = 'test-qr-data';
    
    try {
      const qrCode = await qrcode.toDataURL(testQR);
      
      return res.json({
        working: true,
        message: 'QR code generation is working',
        testQRGenerated: !!qrCode
      });
    } catch (qrError) {
      return res.status(500).json({
        working: false,
        message: `QR code generation failed: ${qrError.message}`
      });
    }
  } catch (error) {
    return res.status(500).json({
      working: false,
      message: `QR code check failed: ${error.message}`
    });
  }
});

app.get('/api/health/subaccount', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check user subscription status
    const { data: userInfo, error: userError } = await supabaseAdmin
      .from('users')
      .select('subscription_status, max_subaccounts, trial_ends_at')
      .eq('id', userId)
      .single();

    if (userError || !userInfo) {
      return res.status(500).json({
        canCreate: false,
        message: 'Failed to fetch user information'
      });
    }

    // Get current subaccounts count
    const { data: currentAccounts } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id', { count: 'exact' })
      .eq('user_id', userId);

    const currentCount = currentAccounts?.length || 0;
    const maxSubaccounts = userInfo.max_subaccounts || 0;
    const canCreate = currentCount < maxSubaccounts;

    return res.json({
      canCreate: canCreate,
      message: canCreate
        ? `Subaccount creation is available. ${maxSubaccounts - currentCount} slot(s) remaining`
        : `Subaccount limit reached. Current: ${currentCount}/${maxSubaccounts}`,
      currentSubaccounts: currentCount,
      maxSubaccounts: maxSubaccounts,
      subscriptionStatus: userInfo.subscription_status,
      trialEndsAt: userInfo.trial_ends_at
    });
  } catch (error) {
    return res.status(500).json({
      canCreate: false,
      message: `Subaccount check failed: ${error.message}`
    });
  }
});

app.get('/api/health/email', requireAuth, async (req, res) => {
  try {
    const hasResend = !!process.env.RESEND_API_KEY;
    const hasSendGrid = !!process.env.SENDGRID_API_KEY;
    const hasSMTP = !!(process.env.SMTP_HOST || process.env.SMTP_USER);
    
    const configured = hasResend || hasSendGrid || hasSMTP;
    
    let provider = 'Not configured';
    if (hasResend) provider = 'Resend';
    else if (hasSendGrid) provider = 'SendGrid';
    else if (hasSMTP) provider = 'SMTP';
    
    return res.json({
      configured: configured,
      message: configured
        ? `Email service is configured using ${provider}`
        : 'Email service is not configured. OTP and notification emails will not work.',
      provider: provider,
      hasResend: hasResend,
      hasSendGrid: hasSendGrid,
      hasSMTP: hasSMTP
    });
  } catch (error) {
    return res.status(500).json({
      configured: false,
      message: `Email service check failed: ${error.message}`
    });
  }
});

app.get('/api/health/webhook', requireAuth, async (req, res) => {
  try {
    // Check if webhook endpoints are accessible
    const webhookEndpoints = [
      '/ghl/provider/webhook',
      '/whatsapp/webhook'
    ];
    
    return res.json({
      operational: true,
      message: 'Webhook handlers are operational',
      endpoints: webhookEndpoints,
      status: 'ready'
    });
  } catch (error) {
    return res.status(500).json({
      operational: false,
      message: `Webhook check failed: ${error.message}`
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Simple webhook test
app.get('/whatsapp/webhook', (req, res) => {
  res.json({ status: 'WhatsApp webhook endpoint is working', timestamp: new Date().toISOString() });
});

// GHL OAuth Routes
app.get('/auth/ghl/connect', (req, res) => {
  const { userId } = req.query;
  
  // If userId provided, pass it in state parameter
  let authUrl;
  if (userId) {
    authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${GHL_CLIENT_ID}&redirect_uri=${encodeURIComponent(GHL_REDIRECT_URI)}&scope=${encodeURIComponent(GHL_SCOPES)}&state=${encodeURIComponent(userId)}`;
  } else {
    // No state parameter - backend will create simple user
    authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${GHL_CLIENT_ID}&redirect_uri=${encodeURIComponent(GHL_REDIRECT_URI)}&scope=${encodeURIComponent(GHL_SCOPES)}`;
  }
  
  console.log('🔗 GHL OAuth redirect:', { userId, hasState: !!userId });
  res.redirect(authUrl);
});

// OAuth callback - handles GHL OAuth 2.0 flow
app.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state, locationId } = req.query;
    
    console.log('OAuth Callback received - ALL PARAMS:', req.query);
    console.log('Specific params:', { code: !!code, locationId, state });
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code not provided' });
    }

    // Don't require locationId in query - GHL may provide it in token response
    console.log('Proceeding with token exchange...');

    // Exchange code for access token
    const tokenResponse = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
      },
      body: new URLSearchParams({
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        user_type: 'Location', // Required by GHL OAuth 2.0
        redirect_uri: GHL_REDIRECT_URI
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText,
        clientId: GHL_CLIENT_ID ? 'SET' : 'MISSING',
        redirectUri: GHL_REDIRECT_URI
      });
      return res.status(400).json({ 
        error: 'Failed to exchange authorization code for token',
        details: errorText
      });
    }

    const tokenData = await tokenResponse.json();
    console.log('Token data received:', { 
      userType: tokenData.userType, 
      companyId: tokenData.companyId, 
      locationId: tokenData.locationId,
      userId: tokenData.userId 
    });

    // Use state as target user ID (passed from frontend)
    // Only logged-in users can add subaccounts
    let targetUserId = null;
    
    if (!state) {
      console.error('❌ State parameter missing - user must be logged in');
      return res.status(400).json({ 
        error: 'Authentication required. Please login to add GHL accounts.',
        code: 'AUTH_REQUIRED'
      });
    }
    
    try {
      targetUserId = decodeURIComponent(state);
      console.log('Using target user ID from state:', targetUserId);
      
      // Check if user exists (must be existing user from login)
      const { data: existingUser, error: userCheckError } = await supabaseAdmin
        .from('users')
        .select('id, name, email')
        .eq('id', targetUserId)
        .maybeSingle();
        
      if (userCheckError) {
        console.error('Error checking user:', userCheckError);
        return res.status(500).json({ error: 'Database error checking user' });
      }
      
      if (!existingUser) {
        console.error('❌ User not found! Only existing users can connect GHL accounts.');
        return res.status(400).json({ 
          error: 'User not found. Please login first.',
          code: 'USER_NOT_FOUND'
        });
      }
      
      console.log('✅ Existing user found:', existingUser);
      
    } catch (e) {
      console.error('Error decoding state:', e);
      return res.status(400).json({ 
        error: 'Invalid authentication. Please login again.',
        code: 'INVALID_STATE'
      });
    }

    // Store GHL account information - use locationId from token response
    const finalLocationId = tokenData.locationId || locationId;
    console.log('Using location ID:', finalLocationId);
    
    const expiryTimestamp = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
    // ===========================================
    // TRIAL SYSTEM CHECKS - Before storing GHL account
    // ===========================================
    
    // 1. Get user subscription info
    const { data: userInfo, error: userInfoError } = await supabaseAdmin
      .from('users')
      .select('subscription_status, max_subaccounts, total_subaccounts, email, trial_ends_at')
      .eq('id', targetUserId)
      .single();
    
    if (userInfoError || !userInfo) {
      console.error('❌ Error fetching user subscription info:', userInfoError);
      return res.status(500).json({ 
        error: 'Failed to check subscription status',
        requiresUpgrade: true
      });
    }
    
    console.log('📊 User subscription info:', {
      status: userInfo.subscription_status,
      current: userInfo.total_subaccounts,
      max: userInfo.max_subaccounts
    });

    // Check if subscription/trial is expired - BLOCK NEW ACCOUNT CREATION
    // IMPORTANT: Only check trial expiry if user is on trial/free plan
    // Active subscriptions (starter/professional) should NOT be blocked by trial_ends_at
    // NOTE: past_due status does NOT block - existing accounts continue working
    const isOnTrial = userInfo.subscription_status === 'trial' || userInfo.subscription_status === 'free';
    const trialExpired = isOnTrial && userInfo.trial_ends_at && new Date(userInfo.trial_ends_at) <= new Date();
    
    // Check if cancelled subscription has passed subscription_ends_at
    const subscriptionExpired = userInfo.subscription_status === 'cancelled' && 
                               userInfo.subscription_ends_at && 
                               new Date(userInfo.subscription_ends_at) <= new Date();
    
    const isExpired = userInfo.subscription_status === 'expired' || 
                      subscriptionExpired ||
                      trialExpired;
    
    if (isExpired) {
      console.log('❌ Subscription/trial expired - blocking account addition', {
        status: userInfo.subscription_status,
        trial_ends_at: userInfo.trial_ends_at,
        isOnTrial,
        trialExpired
      });
      const frontendUrl = process.env.FRONTEND_URL || 'https://octendr.com';
      return res.redirect(`${frontendUrl}/dashboard/add-subaccount?error=subscription_expired`);
    }
    
    // For past_due: Allow account creation but redirect to payment page
    if (userInfo.subscription_status === 'past_due') {
      console.log('⚠️ Payment failed (past_due) - redirecting to payment page', {
        status: userInfo.subscription_status
      });
      const frontendUrl = process.env.FRONTEND_URL || 'https://octendr.com';
      return res.redirect(`${frontendUrl}/dashboard/add-subaccount?error=payment_failed&status=past_due`);
    }
    
    // 2. Check if location already used by another user (anti-abuse)
    const { data: existingLocation } = await supabaseAdmin
      .from('used_locations')
      .select('location_id, email, user_id, is_active')
      .eq('location_id', finalLocationId)
      .maybeSingle();
    
    // If location exists and is linked to different user, block it
    if (existingLocation && existingLocation.user_id !== targetUserId) {
      console.log('⚠️ Location already linked to another user:', existingLocation);
      
      // Log the location conflict event
      await supabaseAdmin.from('subscription_events').insert({
        user_id: targetUserId,
        event_type: 'location_blocked',
        plan_name: userInfo.subscription_status,
        metadata: {
          blocked_location_id: finalLocationId,
          original_owner_email: existingLocation.email,
          reason: 'Location already linked to different account'
        }
      });
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://octendr.com';
      return res.redirect(`${frontendUrl}/dashboard?error=location_exists`);
    }
    
    // 3. Check if this location was previously used by this user (even if deleted)
    // ===========================================
    // CHECK LOCATION OWNERSHIP: ghl_accounts FIRST, then used_locations
    // ===========================================
    // Step 1: Check if location exists in ghl_accounts (active account)
    const { data: existingActiveAccount, error: activeAccountError } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id, location_id, user_id')
      .eq('location_id', finalLocationId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (activeAccountError) {
      console.error('❌ Error checking ghl_accounts:', activeAccountError);
    }

    // Step 2: Check if location exists in used_locations (previously owned, may be deleted)
    const { data: previouslyUsedLocation, error: locationCheckError } = await supabaseAdmin
      .from('used_locations')
      .select('location_id, user_id, is_active')
      .eq('location_id', finalLocationId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (locationCheckError) {
      console.error('❌ Error checking used_locations:', locationCheckError);
    }

    // Determine if this is a re-add or new location
    const isActiveInGhlAccounts = existingActiveAccount !== null && 
                                  existingActiveAccount.user_id === targetUserId;
    const isPreviouslyOwned = previouslyUsedLocation !== null && 
                               previouslyUsedLocation.user_id === targetUserId &&
                               previouslyUsedLocation.location_id === finalLocationId;
    
    console.log(`🔍 Location ownership check:`);
    console.log(`   Location ID: ${finalLocationId}`);
    console.log(`   User ID: ${targetUserId}`);
    console.log(`   Active in ghl_accounts: ${isActiveInGhlAccounts ? 'YES' : 'NO'}`);
    console.log(`   Previously owned (used_locations): ${isPreviouslyOwned ? 'YES' : 'NO'}`);
    
    // If location is active in ghl_accounts, it's already added - handle duplicate check later
    // If location is in used_locations (even if deleted), user can re-add it
    const isReAddingLocation = isPreviouslyOwned;
    
    if (isReAddingLocation) {
      console.log(`✅ Location previously owned by this user - re-adding allowed`);
      console.log(`   User can re-add this location without limit check`);
    } else {
      console.log(`📍 NEW location detected - user never owned this location before`);
      console.log(`   Must pass subaccount limit check`);
      
      // Count current active GHL accounts
      const { data: currentAccounts, error: countError } = await supabaseAdmin
        .from('ghl_accounts')
        .select('id', { count: 'exact' })
        .eq('user_id', targetUserId);
      
      const currentCount = currentAccounts?.length || 0;
      
      // IMPORTANT: Also count total previously owned locations (including deleted ones)
      // This prevents users from deleting and adding NEW locations to bypass limits
      const { data: allOwnedLocations } = await supabaseAdmin
        .from('used_locations')
        .select('location_id')
        .eq('user_id', targetUserId);
      
      const totalOwnedCount = allOwnedLocations?.length || 0;
      
      console.log(`📊 Current active subaccounts: ${currentCount}`);
      console.log(`📊 Total previously owned locations: ${totalOwnedCount}`);
      console.log(`📊 Max allowed: ${userInfo.max_subaccounts}`);
      
      // CRITICAL: If user has EVER owned locations up to the limit, they can only re-add those
      // They CANNOT add NEW locations if they've reached their limit before
      if (totalOwnedCount >= userInfo.max_subaccounts) {
        console.log(`❌ User has already reached their limit (${totalOwnedCount} previously owned locations)`);
        console.log(`🚫 Cannot add NEW location - user must re-add one of their previously owned locations`);
        
        // Get list of previously owned locations that user can re-add
        const { data: previouslyOwnedLocations } = await supabaseAdmin
          .from('used_locations')
          .select('location_id')
          .eq('user_id', targetUserId)
          .order('last_active_at', { ascending: false });
        
        const availableLocations = previouslyOwnedLocations?.map(loc => loc.location_id) || [];
        const availableCount = availableLocations.length;
        
        // Log the limit reached event
        await supabaseAdmin.from('subscription_events').insert({
          user_id: targetUserId,
          event_type: 'subaccount_limit_reached',
          plan_name: userInfo.subscription_status,
          metadata: {
            current_count: currentCount,
            total_owned_count: totalOwnedCount,
            max_allowed: userInfo.max_subaccounts,
            attempted_location: finalLocationId,
            is_new_location: true,
            available_locations_count: availableCount,
            available_location_ids: availableLocations
          }
        });
        
        const frontendUrl = process.env.FRONTEND_URL || 'https://octendr.com';
        
        // For past_due: Redirect to payment page instead of blocking
        if (userInfo.subscription_status === 'past_due') {
          return res.redirect(`${frontendUrl}/dashboard/add-subaccount?error=payment_failed&status=past_due`);
        } else {
          // For both active and trial users - same limit reached message (buttons already locked on frontend)
          return res.redirect(`${frontendUrl}/dashboard?error=limit_reached&current=${currentCount}&max=${userInfo.max_subaccounts}`);
        }
      }
      
      // Also check current active count (for users who haven't reached their limit yet)
      if (currentCount >= userInfo.max_subaccounts) {
        console.log(`❌ Subaccount limit reached. Current: ${currentCount}, Max: ${userInfo.max_subaccounts}`);
        console.log(`🚫 Cannot add NEW location - user must upgrade or purchase additional subaccount`);
        
        // Get list of previously owned locations that user can re-add (from used_locations)
        const { data: previouslyOwnedLocations } = await supabaseAdmin
          .from('used_locations')
          .select('location_id')
          .eq('user_id', targetUserId)
          .order('last_active_at', { ascending: false });
        
        const availableLocations = previouslyOwnedLocations?.map(loc => loc.location_id) || [];
        const availableCount = availableLocations.length;
        
        // Log the limit reached event
        await supabaseAdmin.from('subscription_events').insert({
          user_id: targetUserId,
          event_type: 'subaccount_limit_reached',
          plan_name: userInfo.subscription_status,
          metadata: {
            current_count: currentCount,
            max_allowed: userInfo.max_subaccounts,
            attempted_location: finalLocationId,
            is_new_location: true,
            available_locations_count: availableCount,
            available_location_ids: availableLocations
          }
        });
        
        const frontendUrl = process.env.FRONTEND_URL || 'https://octendr.com';
        
        // For past_due: Redirect to payment page instead of blocking
        if (userInfo.subscription_status === 'past_due') {
          return res.redirect(`${frontendUrl}/dashboard/add-subaccount?error=payment_failed&status=past_due`);
        } else {
          // For both active and trial users - same limit reached message (buttons already locked on frontend)
          return res.redirect(`${frontendUrl}/dashboard?error=limit_reached&current=${currentCount}&max=${userInfo.max_subaccounts}`);
        }
      }
      
      console.log('✅ Subaccount limit check passed for new location');
    }
    
    // ===========================================
    // CHECK FOR DUPLICATE SUBACCOUNT (Same Location ID for Same User)
    // ===========================================
    const { data: existingGhlAccount, error: duplicateCheckError } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id, location_id, created_at')
      .eq('user_id', targetUserId)
      .eq('location_id', finalLocationId)
      .maybeSingle();
    
    if (duplicateCheckError) {
      console.error('❌ Error checking for duplicate subaccount:', duplicateCheckError);
      return res.status(500).json({ 
        error: 'Failed to check for duplicate account',
        details: duplicateCheckError.message
      });
    }
    
    if (existingGhlAccount) {
      console.log('⚠️ This account is already added for this user:', {
        location_id: finalLocationId,
        existing_account_id: existingGhlAccount.id,
        created_at: existingGhlAccount.created_at
      });
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://octendr.com';
      return res.redirect(`${frontendUrl}/dashboard?error=account_already_added`);
    }
    
    // User already verified above, proceed with GHL account storage
    
    const { error: ghlError } = await supabaseAdmin
      .from('ghl_accounts')
      .insert({
        user_id: targetUserId,
        company_id: tokenData.companyId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        location_id: finalLocationId,
        expires_at: expiryTimestamp,  // Old column (required)
        token_expires_at: expiryTimestamp  // New column (for auto-refresh)
      });

    if (ghlError) {
      console.error('❌ Error storing GHL account:', ghlError);
      console.error('❌ Error details:', {
        message: ghlError.message,
        code: ghlError.code,
        details: ghlError.details,
        hint: ghlError.hint
      });
      return res.status(500).json({ 
        error: 'Failed to store account information',
        details: ghlError.message,
        hint: ghlError.hint
      });
    }

    console.log('GHL account stored successfully');
    
    // ===========================================
    // SAVE LOCATION TO used_locations (ANTI-ABUSE)
    // ===========================================
    const { data: savedAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id, location_id')
      .eq('user_id', targetUserId)
      .eq('location_id', finalLocationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (savedAccount) {
      // Check if location already tracked by THIS user (important for user_id check)
      const { data: existingLocation } = await supabaseAdmin
        .from('used_locations')
        .select('id, user_id')
        .eq('location_id', finalLocationId)
        .eq('user_id', targetUserId)  // CRITICAL: Check user_id to avoid conflicts
        .maybeSingle();
      
      if (!existingLocation) {
        // Save to used_locations for anti-abuse - NEW location being added
        const insertData = {
          location_id: finalLocationId,
          user_id: targetUserId,
          email: userInfo.email,
          ghl_account_id: savedAccount.id,
          first_used_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
          is_active: true
        };
        
        const { error: insertError } = await supabaseAdmin
          .from('used_locations')
          .insert(insertData);
        
        if (insertError) {
          console.error('❌ Error saving location to used_locations:', insertError);
        } else {
          console.log('✅ Location saved to used_locations - user can re-add this location later');
          console.log(`   Location ID: ${finalLocationId}, User ID: ${targetUserId}`);
        }
      } else {
        // Update existing location to active (user is re-adding a previously owned location)
        const updateData = {
          last_active_at: new Date().toISOString(),
          ghl_account_id: savedAccount.id,
          is_active: true
        };
        
        const { error: updateError } = await supabaseAdmin
          .from('used_locations')
          .update(updateData)
          .eq('location_id', finalLocationId)
          .eq('user_id', targetUserId);
        
        if (updateError) {
          console.error('❌ Error updating location in used_locations:', updateError);
        } else {
          console.log('✅ Updated existing location in used_locations - reactivated');
          console.log(`   Location ID: ${finalLocationId}, User ID: ${targetUserId}`);
        }
      }
    }
    
    const frontendUrl = process.env.FRONTEND_URL || 'https://whatsappghl.vercel.app';
    
    // Get user data for redirect - ensure we get the correct user
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, email')
      .eq('id', targetUserId)
      .single();
    
    console.log('🔍 User data for redirect:', { userData, userError, targetUserId });
    
    if (userData) {
      // Redirect to dashboard with success message
      console.log('✅ Redirecting with user data:', userData);
      res.redirect(`${frontendUrl}/dashboard?success=account_added`);
    } else {
      console.error('❌ User not found for redirect:', userError);
      // Fallback redirect to dashboard
      res.redirect(`${frontendUrl}/dashboard?success=account_added`);
    }
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

// Get user subscription info and previously owned locations
app.get('/api/user/subscription-info', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user subscription info
    const { data: userInfo, error: userError } = await supabaseAdmin
      .from('users')
      .select('subscription_status, max_subaccounts, trial_ends_at')
      .eq('id', userId)
      .single();
    
    if (userError || !userInfo) {
      console.error('Error fetching user info:', userError);
      return res.status(500).json({ error: 'Failed to fetch user info' });
    }
    
    // Get current subaccounts count
    const { data: currentAccounts, error: accountsError } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id', { count: 'exact' })
      .eq('user_id', userId);
    
    const currentCount = currentAccounts?.length || 0;
    
    // Get all active locations from ghl_accounts (to exclude them from available locations)
    const { data: activeAccounts } = await supabaseAdmin
      .from('ghl_accounts')
      .select('location_id')
      .eq('user_id', userId);
    
    const activeLocationIds = (activeAccounts || []).map(acc => acc.location_id);
    
    // Get previously owned locations from used_locations
    const { data: previouslyOwnedLocations, error: locationsError } = await supabaseAdmin
      .from('used_locations')
      .select('location_id, is_active, last_active_at')
      .eq('user_id', userId)
      .order('last_active_at', { ascending: false });
    
    // Filter for inactive locations (not in ghl_accounts and is_active: false)
    const availableLocations = (previouslyOwnedLocations || [])
      .filter(loc => {
        // Exclude if location is currently active in ghl_accounts
        if (activeLocationIds.includes(loc.location_id)) {
          return false;
        }
        // If is_active column exists, only include inactive ones
        // If column doesn't exist, include all (for backward compatibility)
        return loc.hasOwnProperty('is_active') ? !loc.is_active : true;
      })
      .map(loc => loc.location_id);
    
    res.json({
      subscription_status: userInfo.subscription_status,
      max_subaccounts: userInfo.max_subaccounts || 0,
      current_subaccounts: currentCount,
      trial_ends_at: userInfo.trial_ends_at,
      previously_owned_locations: availableLocations,
      can_add_new: currentCount < (userInfo.max_subaccounts || 0),
      limit_reached: currentCount >= (userInfo.max_subaccounts || 0)
    });
  } catch (error) {
    console.error('Error fetching subscription info:', error);
    res.status(500).json({ error: 'Failed to fetch subscription info' });
  }
});

// Admin routes
// Password management endpoints
// Change password (requires authentication)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // Get user from database
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, password')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await verifyPassword(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password in database
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating password:', updateError);
      return res.status(500).json({ error: 'Failed to update password' });
    }

    console.log(`✅ Password changed for user ${userId}`);
    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

// Send OTP for password reset
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user from database
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('email', email)
      .eq('is_verified', true)
      .single();

    // Always return success to prevent email enumeration
    if (userError || !user) {
      return res.json({ success: true, message: 'If the email exists, an OTP has been sent' });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database (create a password_resets table or use a simple cache)
    // For now, we'll store it in a password_resets table
    const { error: otpError } = await supabaseAdmin
      .from('password_resets')
      .upsert({
        email: user.email,
        otp: otp,
        expires_at: expiresAt.toISOString(),
        used: false
      }, {
        onConflict: 'email'
      });

    if (otpError) {
      console.error('Error storing OTP:', otpError);
      // Still return success to prevent email enumeration
      return res.json({ success: true, message: 'If the email exists, an OTP has been sent' });
    }

    // Send OTP via email
    const userName = user.name || user.email.split('@')[0];
    const subject = 'Password Reset OTP - Octendr';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset OTP</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f5f5f5;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
              padding: 0;
            }
            .header {
              background: linear-gradient(135deg, #075E54 0%, #128C7E 100%);
              padding: 30px;
              text-align: center;
              color: white;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
              font-weight: 700;
            }
            .content {
              padding: 40px 30px;
            }
            .otp-box {
              background: #F0F2F5;
              border: 2px dashed #25D366;
              padding: 20px;
              margin: 30px 0;
              border-radius: 8px;
              text-align: center;
            }
            .otp-code {
              font-size: 32px;
              font-weight: 700;
              color: #25D366;
              letter-spacing: 8px;
              margin: 10px 0;
            }
            .warning-box {
              background: #FFF3E0;
              border-left: 4px solid #FF9800;
              padding: 15px 20px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .warning-box strong {
              color: #E65100;
              display: block;
              margin-bottom: 10px;
            }
            .footer {
              background: #F0F2F5;
              padding: 20px;
              text-align: center;
              color: #54656F;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Password Reset</h1>
            </div>
            <div class="content">
              <p>Hello ${userName},</p>
              <p>You requested to reset your password. Use the OTP below to reset your password:</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
              </div>
              <div class="warning-box">
                <strong>⏰ Important:</strong>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>This OTP expires in 10 minutes</li>
                  <li>Do not share this OTP with anyone</li>
                  <li>If you didn't request this, please ignore this email</li>
                </ul>
              </div>
              <p style="color: #54656F; font-size: 14px; margin-top: 30px;">
                Need help? Contact our support team.
              </p>
            </div>
            <div class="footer">
              <p>This is an automated email from <strong>Octendr</strong></p>
              <p>WhatsApp GHL Integration Platform</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const textContent = `
Password Reset OTP - Octendr

Hello ${userName},

You requested to reset your password. Use the OTP below to reset your password:

OTP: ${otp}

⏰ Important:
- This OTP expires in 10 minutes
- Do not share this OTP with anyone
- If you didn't request this, please ignore this email

This is an automated email from Octendr.
    `;

    const emailResult = await emailService.sendEmailViaAPI({
      to: user.email,
      subject: subject,
      html: htmlContent,
      text: textContent
    });

    if (emailResult.success) {
      console.log(`✅ OTP sent to ${user.email}`);
    } else {
      console.error(`❌ Failed to send OTP email:`, emailResult.error);
    }

    return res.json({ success: true, message: 'If the email exists, an OTP has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    // Always return success to prevent email enumeration
    return res.json({ success: true, message: 'If the email exists, an OTP has been sent' });
  }
});

// Verify OTP and reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // Get OTP from database
    const { data: resetData, error: resetError } = await supabaseAdmin
      .from('password_resets')
      .select('*')
      .eq('email', email)
      .eq('used', false)
      .single();

    if (resetError || !resetData) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Check if OTP matches
    if (resetData.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Check if OTP is expired
    const expiresAt = new Date(resetData.expires_at);
    if (expiresAt < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating password:', updateError);
      return res.status(500).json({ error: 'Failed to reset password' });
    }

    // Mark OTP as used
    await supabaseAdmin
      .from('password_resets')
      .update({ used: true })
      .eq('email', email);

    console.log(`✅ Password reset for user ${user.id}`);
    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.get('/admin/ghl/subaccounts', requireAuth, async (req, res) => {
  try {
    // req.user already set by requireAuth middleware
    const { data: subaccounts } = await supabaseAdmin
      .from('subaccounts')
      .select('*')
      .eq('user_id', req.user.id);

    res.json({ subaccounts: subaccounts || [] });
  } catch (error) {
    console.error('Error fetching subaccounts:', error);
    res.status(500).json({ error: 'Failed to fetch subaccounts' });
  }
});

// Admin Create Session Endpoint
app.post('/admin/create-session', requireAuth, async (req, res) => {
  // Check subscription status before allowing session creation
  try {
    const { data: userInfo } = await supabaseAdmin
      .from('users')
      .select('subscription_status, trial_ends_at')
      .eq('id', req.user?.id)
      .single();
    
    if (userInfo) {
      // IMPORTANT: Only check trial expiry if user is on trial/free plan
      // Active subscriptions (starter/professional) should NOT be blocked by trial_ends_at
      const isOnTrial = userInfo.subscription_status === 'trial' || userInfo.subscription_status === 'free';
      const trialExpired = isOnTrial && userInfo.trial_ends_at && new Date(userInfo.trial_ends_at) <= new Date();
      const isExpired = userInfo.subscription_status === 'expired' || 
                        userInfo.subscription_status === 'cancelled' || 
                        trialExpired;
      
      if (isExpired) {
        return res.status(403).json({ 
          error: 'Subscription expired. Please upgrade to continue using WhatsApp Integration.',
          code: 'SUBSCRIPTION_EXPIRED'
        });
      }
    }
  } catch (checkError) {
    console.error('Error checking subscription for session creation:', checkError);
    // Continue anyway - don't block if check fails
  }
  try {
    const { subaccountId, mode = 'qr' } = req.body;
    
    if (!subaccountId) {
      return res.status(400).json({ error: 'Subaccount ID is required' });
    }

    console.log(`🚀 Creating ${mode} session for subaccount: ${subaccountId}`);

    // Create session in database
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: req.user?.id,
        subaccount_id: subaccountId,
        status: 'initializing',
        qr: null,
        phone_number: null,
        mode: mode // Store the mode
      })
      .select()
      .single();

    if (sessionError) {
      console.error('❌ Database error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to create session' });
    }

    console.log(`✅ Session created with ID: ${session.id}, mode: ${mode}`);

    // Start WhatsApp client creation for QR mode
      const sessionName = `subaccount_${subaccountId}_${session.id}`;
      
      try {
        await waManager.createClient(sessionName);
        console.log(`📱 QR session client created: ${sessionName}`);
      } catch (error) {
        console.error('❌ Error creating QR client:', error);
        // Update session status to error
        await supabaseAdmin
          .from('sessions')
          .update({ status: 'disconnected' })
          .eq('id', session.id);
    }

    res.json({ 
      success: true,
      sessionId: session.id,
      mode: mode,
      message: 'QR session created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Admin Get Session Status
app.get('/admin/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', req.user?.id)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ 
      session: {
        id: session.id,
        status: session.status,
        qr: session.qr,
        phone_number: session.phone_number,
        created_at: session.created_at,
        mode: session.mode
      }
    });
  } catch (error) {
    console.error('❌ Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// =====================================================
// Subaccount Settings & Analytics API Endpoints
// =====================================================

// Get subaccount settings
app.get('/admin/subaccount/:ghlAccountId/settings', requireAuth, async (req, res) => {
  try {
    const { ghlAccountId } = req.params;
    
    // Verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('user_id')
      .eq('id', ghlAccountId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }
    
    const settings = await subaccountHelpers.getSettings(ghlAccountId);
    res.json({ settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update subaccount settings
app.put('/admin/subaccount/:ghlAccountId/settings', requireAuth, async (req, res) => {
  try {
    const { ghlAccountId } = req.params;
    const { create_contact_in_ghl, drip_mode_enabled, drip_messages_per_batch, drip_delay_minutes } = req.body;
    
    // Verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('user_id')
      .eq('id', ghlAccountId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }
    
    // Validate inputs
    const updateData = {};
    if (typeof create_contact_in_ghl === 'boolean') {
      updateData.create_contact_in_ghl = create_contact_in_ghl;
    }
    if (typeof drip_mode_enabled === 'boolean') {
      updateData.drip_mode_enabled = drip_mode_enabled;
    }
    if (typeof drip_messages_per_batch === 'number' && drip_messages_per_batch > 0) {
      updateData.drip_messages_per_batch = drip_messages_per_batch;
    }
    if (typeof drip_delay_minutes === 'number' && drip_delay_minutes >= 0) {
      updateData.drip_delay_minutes = drip_delay_minutes;
    }
    
    const updated = await subaccountHelpers.updateSettings(ghlAccountId, req.user.id, updateData);
    res.json({ settings: updated });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get subaccount analytics
app.get('/admin/subaccount/:ghlAccountId/analytics', requireAuth, async (req, res) => {
  try {
    const { ghlAccountId } = req.params;
    
    // Verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('user_id')
      .eq('id', ghlAccountId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }
    
    const analytics = await subaccountHelpers.getAnalytics(ghlAccountId);
    res.json({ analytics });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get sessions for subaccount (multi-number support)
app.get('/admin/subaccount/:ghlAccountId/sessions', requireAuth, async (req, res) => {
  try {
    const { ghlAccountId } = req.params;
    
    // Verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('user_id')
      .eq('id', ghlAccountId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }
    
    const { data: sessions, error } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccountId)
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    res.json({ sessions: sessions || [] });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Set active session (multi-number support)
app.post('/admin/subaccount/:ghlAccountId/sessions/:sessionId/activate', requireAuth, async (req, res) => {
  try {
    const { ghlAccountId, sessionId } = req.params;
    
    // Verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('user_id')
      .eq('id', ghlAccountId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }
    
    // Verify session belongs to this subaccount
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('subaccount_id', ghlAccountId)
      .maybeSingle();
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Set as active (deactivates others)
    await subaccountHelpers.setActiveSession(sessionId, ghlAccountId);
    
    res.json({ success: true, message: 'Session activated' });
  } catch (error) {
    console.error('Error activating session:', error);
    res.status(500).json({ error: 'Failed to activate session' });
  }
});

// Get drip queue status
app.get('/admin/subaccount/:ghlAccountId/drip-queue', requireAuth, async (req, res) => {
  try {
    const { ghlAccountId } = req.params;
    
    // Verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('user_id')
      .eq('id', ghlAccountId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }
    
    const { data: queue, error } = await supabaseAdmin
      .from('drip_queue')
      .select('*')
      .eq('ghl_account_id', ghlAccountId)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (error) {
      throw error;
    }
    
    // Count by status
    const stats = {
      pending: queue.filter(q => q.status === 'pending').length,
      processing: queue.filter(q => q.status === 'processing').length,
      sent: queue.filter(q => q.status === 'sent').length,
      failed: queue.filter(q => q.status === 'failed').length
    };
    
    res.json({ queue: queue || [], stats });
  } catch (error) {
    console.error('Error fetching drip queue:', error);
    res.status(500).json({ error: 'Failed to fetch drip queue' });
  }
});

// Connect new subaccount
app.post('/admin/ghl/connect-subaccount', requireAuth, async (req, res) => {
  try {
    // req.user already set by requireAuth middleware
    const { ghl_location_id, name } = req.body;

    if (!ghl_location_id) {
      return res.status(400).json({ error: 'ghl_location_id is required' });
    }

    // Check if subaccount already exists
    const { data: existingSubaccount } = await supabaseAdmin
      .from('subaccounts')
      .select('*')
      .eq('ghl_location_id', ghl_location_id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existingSubaccount) {
      return res.json({ 
        success: true, 
        message: 'Subaccount already exists',
        subaccount: existingSubaccount
      });
    }

    // Create subaccount
    const { data: newSubaccount, error: subaccountError } = await supabaseAdmin
        .from('subaccounts')
      .insert({
        user_id: req.user.id,
        ghl_location_id,
        name: name || `Location ${ghl_location_id}`,
        status: 'pending_oauth'
        })
        .select()
        .single();

    if (subaccountError) {
      console.error('Error creating subaccount:', subaccountError);
      return res.status(500).json({ error: 'Failed to create subaccount' });
    }

    // Generate GHL OAuth URL for this specific location
    const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${GHL_CLIENT_ID}&redirect_uri=${encodeURIComponent(GHL_REDIRECT_URI)}&scope=${encodeURIComponent(GHL_SCOPES)}&state=${encodeURIComponent(user.id)}`;

  res.json({ 
      success: true, 
      message: 'Subaccount created, redirect to GHL OAuth',
      authUrl: authUrl,
      subaccount: newSubaccount
    });
  } catch (error) {
    console.error('Error connecting subaccount:', error);
    res.status(500).json({ error: 'Failed to connect subaccount' });
  }
});

// GHL Provider Configuration (for marketplace app)
app.get('/ghl/provider/config', (req, res) => {
  res.json({
    name: "WhatsApp SMS Provider",
    description: "Connect WhatsApp as SMS provider for GoHighLevel",
    version: "1.0.0",
    provider: {
      type: "sms",
      name: "WhatsApp SMS",
      description: "Send and receive SMS via WhatsApp",
      capabilities: ["send", "receive", "status"],
      webhook_url: `${process.env.BACKEND_URL || 'https://api.octendr.com'}/ghl/provider/webhook`
    },
    settings: {
      webhook_url: {
        type: "url",
        label: "Webhook URL",
        description: "URL for receiving incoming messages",
        required: true,
        default: `${process.env.BACKEND_URL || 'https://api.octendr.com'}/ghl/provider/webhook`
      }
    }
  });
});

/**
 * Downloads media from GHL attachment URL
 * @param {string} mediaUrl - GHL media URL
 * @param {string} accessToken - GHL access token
 * @returns {Promise<Buffer>} - Media file buffer
 */
async function downloadGHLMedia(mediaUrl, accessToken) {
  try {
    console.log(`📥 Downloading media from GHL: ${mediaUrl}`);
    
    // Use proper GHL headers with Version (required for GHL API)
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-07-28', // GHL API version - required
        'User-Agent': 'WhatsApp-Bridge/1.0',
        'Accept': '*/*',
        'Referer': 'https://app.gohighlevel.com/'
      },
      timeout: 60000 // 60 second timeout for large files
    });
    
    console.log(`✅ Downloaded ${response.data.byteLength} bytes from GHL`);
    return Buffer.from(response.data);
    
  } catch (error) {
    console.error('❌ Failed to download GHL media:', error.message);
    console.error('   Status:', error.response?.status);
    console.error('   URL:', mediaUrl);
    
    if (error.response?.status === 401) {
      console.error('   ⚠️ GHL media URL requires authorization - token may be invalid or URL expired');
    }
    
    throw new Error(`GHL media download failed: ${error.message}`);
  }
}

/**
 * Detects media type from URL or content type
 * @param {string} url - Media URL
 * @param {string} contentType - Optional content type header
 * @returns {string} - Media type: 'image', 'video', 'document', 'audio'
 */
function detectMediaType(url, contentType) {
  const lowerUrl = url.toLowerCase();
  const lowerContentType = (contentType || '').toLowerCase();
  
  // Check content type first
  if (lowerContentType.includes('image/')) return 'image';
  if (lowerContentType.includes('video/')) return 'video';
  if (lowerContentType.includes('audio/')) return 'audio';
  if (lowerContentType.includes('application/') || lowerContentType.includes('document/')) return 'document';
  
  // Check URL extension
  if (lowerUrl.includes('.png') || lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg') || 
      lowerUrl.includes('.gif') || lowerUrl.includes('.webp') || lowerUrl.includes('.bmp')) {
    return 'image';
  }
  
  if (lowerUrl.includes('.mp4') || lowerUrl.includes('.avi') || lowerUrl.includes('.mov') || 
      lowerUrl.includes('.mkv') || lowerUrl.includes('.webm')) {
    return 'video';
  }
  
  if (lowerUrl.includes('.mp3') || lowerUrl.includes('.ogg') || lowerUrl.includes('.wav') || 
      lowerUrl.includes('.m4a') || lowerUrl.includes('.aac')) {
    return 'audio';
  }
  
  // Default to document for everything else (PDF, DOC, etc.)
  return 'document';
}

// GHL Provider Webhook (for incoming messages)
app.post('/ghl/provider/webhook', async (req, res) => {
  try {
    console.log('📥 GHL Webhook Received:', {
      type: req.body.type,
      locationId: req.body.locationId,
      phone: req.body.phone,
      messageId: req.body.messageId,
      timestamp: new Date().toISOString()
    });
    
    // Skip InboundMessage - this is echo of messages we sent to GHL
    if (req.body.type === 'InboundMessage') {
      console.log('⏭️ Skipping InboundMessage (echo)');
      return res.json({ status: 'skipped', reason: 'inbound_message_echo' });
    }
    
    // Skip SMS type - duplicate of OutboundMessage
    if (req.body.type === 'SMS') {
      console.log('⏭️ Skipping SMS type (duplicate)');
      return res.json({ status: 'skipped', reason: 'sms_type_duplicate' });
    }
    
    // Skip other non-message types (silent skip)
    if (req.body.type !== 'OutboundMessage') {
      console.log(`⏭️ Skipping webhook type: ${req.body.type}`);
      return res.json({ status: 'skipped', reason: `unsupported_type_${req.body.type}` });
    }
    
    console.log('✅ Processing OutboundMessage webhook');
    console.log('📋 Webhook Debug - Full request body:', JSON.stringify(req.body, null, 2));
    
    // Process OutboundMessage - actual messages from GHL
    // GHL OutboundMessage may have phone in different fields, check all possibilities
    const { locationId, message, contactId, phone, attachments = [], body, messageId, conversationId } = req.body;
    
    // Use 'body' field if 'message' is not available (GHL uses 'body' for OutboundMessage)
    const messageText = message || body || '';
    
    console.log('📋 Webhook Debug - Extracted fields:', {
      locationId,
      contactId,
      phone,
      messageId,
      conversationId,
      messageText: messageText.substring(0, 50),
      hasAttachments: attachments && attachments.length > 0
    });
    
    // Prevent duplicate processing using messageId
    if (messageId) {
    if (!global.messageCache) {
        global.messageCache = new Map();
      }
      if (global.messageCache.has(messageId)) {
        const cachedData = global.messageCache.get(messageId);
        const timeSinceCached = Date.now() - cachedData.timestamp;
        if (timeSinceCached < 5 * 60 * 1000) { // 5 minutes
          return res.json({ success: true, status: 'duplicate_ignored', messageId });
        } else {
          global.messageCache.delete(messageId);
        }
      }
      global.messageCache.set(messageId, {
        timestamp: Date.now(),
        messageId: messageId,
        locationId,
        contactId
      });
    }
    
    if (!locationId) {
      return res.json({ status: 'success' });
    }
    
    // Allow empty message for attachment-only messages
    if (!messageText && (!attachments || attachments.length === 0)) {
      return res.json({ status: 'success' });
    }
    
    // Ignore messages that contain media URLs (echo prevention)
    if (messageText && (
      messageText.includes('storage.googleapis.com/msgsndr') || 
      messageText.startsWith('https://storage.googleapis.com') ||
      (messageText.startsWith('https://') && messageText.includes('msgsndr'))
    )) {
      return res.json({ status: 'success', reason: 'media_url_echo' });
    }
    
    // Get GHL account
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    if (!ghlAccount) {
      return res.json({ status: 'success' });
    }

    // Ensure valid token (auto-refresh if needed)
    let validToken;
    try {
      validToken = await ensureValidToken(ghlAccount);
    } catch (error) {
      console.error(`❌ Token validation failed for GHL account ${ghlAccount.id}:`, error);
      return res.json({ status: 'error', message: 'Token validation failed' });
    }

    // Get subaccount settings
    const settings = await subaccountHelpers.getSettings(ghlAccount.id);
    
    // Check if drip mode is enabled
    if (settings.drip_mode_enabled) {
      // Add to drip queue instead of sending immediately
      try {
        await subaccountHelpers.addToDripQueue(ghlAccount.id, ghlAccount.user_id, {
          contactId: contactId || null,
          phone: phoneNumber,
          message: messageText,
          messageType: 'text',
          attachments: attachments || []
        });
        console.log(`📥 Message added to drip queue for location: ${locationId}`);
        return res.json({ status: 'queued', message: 'Message added to drip queue' });
      } catch (queueError) {
        console.error('Error adding to drip queue:', queueError);
        // Fall through to send immediately if queue fails
      }
    }
    
    // Get active WhatsApp session (multi-number support)
    let session = await subaccountHelpers.getActiveSession(ghlAccount.id);
    
    // Fallback to old method if no active session found
    if (!session) {
      const { data: fallbackSession } = await supabaseAdmin
        .from('sessions')
        .select('*')
        .eq('subaccount_id', ghlAccount.id)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!fallbackSession) {
        return res.json({ status: 'error', message: 'No active WhatsApp session found' });
      }
      
      // Use fallback session
      session = fallbackSession;
    }
    
    // Get WhatsApp client using Baileys
    const cleanSubaccountId = session.subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const clientKey = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    
    console.log(`🔍 Webhook Debug - Session ID: ${session.id}`);
    console.log(`🔍 Webhook Debug - Subaccount ID: ${session.subaccount_id}`);
    console.log(`🔍 Webhook Debug - Client Key: ${clientKey}`);
    console.log(`🔍 Webhook Debug - Session Status: ${session.status}`);
    
    const clientStatus = waManager.getClientStatus(clientKey);
    console.log(`🔍 Webhook Debug - Client Status:`, clientStatus);
    
    // Try to get all available clients to see what's available
    const allClients = waManager.getAllClients();
    console.log(`🔍 Webhook Debug - Available Clients:`, allClients.map(c => ({ sessionId: c.sessionId, status: c.status })));
    
    if (!clientStatus || (clientStatus.status !== 'connected' && clientStatus.status !== 'ready')) {
      console.error(`❌ WhatsApp client not ready for webhook - Key: ${clientKey}, Status: ${clientStatus?.status || 'not found'}`);
      return res.json({ 
        status: 'error', 
        message: 'WhatsApp client not connected',
        clientKey: clientKey,
        clientStatus: clientStatus?.status || 'not found',
        availableClients: allClients.map(c => c.sessionId)
      });
    }
    
    // Get phone number from webhook data or fetch from contactId
    let phoneNumber = req.body.phone || req.body.contactPhone || req.body.recipientPhone;
    
    // If phone is not in webhook, fetch from contactId
    if (!phoneNumber && contactId) {
      console.log(`🔍 Phone not in webhook, fetching from contactId: ${contactId}`);
      try {
        const contactRes = await makeGHLRequest(`${BASE}/contacts/${contactId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${validToken}`,
            Version: "2021-07-28",
            "Content-Type": "application/json"
          }
        }, ghlAccount);
        
        if (contactRes.ok) {
          const contactData = await contactRes.json();
          phoneNumber = contactData.contact?.phone || contactData.phone;
          if (phoneNumber) {
            console.log(`✅ Phone number fetched from contact: ${phoneNumber}`);
          } else {
            console.error(`❌ Contact found but no phone number in response:`, contactData);
          }
        } else {
          const errorText = await contactRes.text();
          console.error(`❌ Failed to fetch contact ${contactId}:`, errorText);
          
          // Try fetching from conversation if contactId fails
          if (conversationId) {
            console.log(`🔍 Trying to fetch contact from conversation: ${conversationId}`);
            try {
              const convRes = await makeGHLRequest(`${BASE}/conversations/${conversationId}`, {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${validToken}`,
                  Version: "2021-07-28",
                  "Content-Type": "application/json"
                }
              }, ghlAccount);
              
              if (convRes.ok) {
                const convData = await convRes.json();
                phoneNumber = convData.conversation?.contact?.phone || convData.contact?.phone || convData.phone;
                if (phoneNumber) {
                  console.log(`✅ Phone number fetched from conversation: ${phoneNumber}`);
                }
              }
            } catch (convError) {
              console.error(`❌ Error fetching conversation:`, convError.message);
            }
          }
        }
      } catch (contactError) {
        console.error(`❌ Error fetching contact:`, contactError.message);
      }
    }
    
    if (!phoneNumber) {
      console.error(`❌ No phone number available - phone: ${req.body.phone}, contactId: ${contactId}, conversationId: ${conversationId}`);
      console.error(`❌ Webhook body keys:`, Object.keys(req.body));
      return res.json({ status: 'error', message: 'No phone number available', body: req.body });
    }
    
    // Ensure phone number is in E.164 format (with +)
    if (phoneNumber && !phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber.replace(/^\+/, '');
    }
    
    console.log(`📱 Sending message to phone: ${phoneNumber} (from GHL webhook)`);
    console.log(`📱 Webhook Debug - Message Text: "${messageText}"`);
    console.log(`📱 Webhook Debug - Message ID: ${messageId}`);
    console.log(`📱 Webhook Debug - Client Key: ${clientKey}`);
    
    // Check if this message was just received from WhatsApp (prevent echo)
    const recentMessageKey = `whatsapp_${phoneNumber}_${messageText}`;
    if (global.recentMessages && global.recentMessages.has(recentMessageKey)) {
      return res.json({ status: 'success', reason: 'echo_prevented' });
    }
    
    // Simple echo prevention
    const messageContent = messageText.toLowerCase().trim();
    const recentMessages = global.recentMessages || new Set();
    let isRecentEcho = false;
    
    for (const key of recentMessages) {
      if (key.startsWith(`whatsapp_${phoneNumber}_`)) {
        const recentContent = key.split('_').slice(2).join('_').toLowerCase().trim();
        if (recentContent === messageContent) {
          isRecentEcho = true;
          break;
        }
      }
    }
    
    if (isRecentEcho) {
      return res.json({ status: 'success', reason: 'echo_prevented' });
    }
    
    // Process and send message (text and/or media)
    try {
      // Check if we have attachments to send
      if (attachments && attachments.length > 0) {
        // Ensure token is available
        if (!validToken) {
          validToken = await ensureValidToken(ghlAccount);
        }
        
        // Process each attachment
        for (let i = 0; i < attachments.length; i++) {
          const attachmentUrl = attachments[i];
          try {
            let mediaType = detectMediaType(attachmentUrl);
            let mediaPayload = null;
            let fileName = null;
            
            try {
              const mediaBuffer = await downloadGHLMedia(attachmentUrl, validToken);
              mediaPayload = mediaBuffer;
            } catch (downloadError) {
              mediaPayload = attachmentUrl; // Fallback to URL
            }
            
            if (mediaType === 'document' || mediaType === 'audio') {
              const urlParts = attachmentUrl.split('/');
              const lastPart = urlParts[urlParts.length - 1];
              if (lastPart && lastPart.includes('.')) {
                fileName = lastPart.split('?')[0];
              }
            }
            
            const caption = (i === 0 && messageText) ? messageText : '';
            
            const attachResult = await waManager.sendMessage(
              clientKey, 
              phoneNumber, 
              caption, 
              mediaType, 
              mediaPayload,
              fileName
            );
            
            // Check if attachment send was skipped/failed
            if (attachResult && attachResult.status === 'skipped') {
              console.error(`❌ Attachment skipped: ${attachResult.reason}`);
              
              // Send error message to GHL conversation
              try {
                if (contactId) {
                  let errorMessage = '';
                  if (attachResult.reason === 'Number does not have WhatsApp') {
                    errorMessage = `⚠️ Attachment delivery failed\n\n❌ ${phoneNumber} does not have WhatsApp\n\n💡 Please verify the phone number or use another contact method.`;
                  } else {
                    errorMessage = `⚠️ Attachment delivery failed\n\nReason: ${attachResult.reason || 'Unknown error'}\n\nPhone: ${phoneNumber}`;
                  }
                  
                  const errorPayload = {
                    type: "SMS",
                    conversationProviderId: ghlAccount.conversation_provider_id || getProviderId(),
                    contactId: contactId,
                    message: errorMessage,
                    direction: "inbound",
                    status: "delivered",
                    altId: `error_${Date.now()}`
                  };
                  
                  const errorRes = await makeGHLRequest(`${BASE}/conversations/messages/inbound`, {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${validToken}`,
                      Version: "2021-07-28",
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify(errorPayload)
                  }, ghlAccount);
                  
                  if (errorRes.ok) {
                    console.log(`✅ Error message sent to GHL conversation for attachment failure`);
                  }
                }
              } catch (errorMsgError) {
                console.error(`❌ Error sending error message to GHL:`, errorMsgError.message);
              }
            }
            
          } catch (attachError) {
            console.error(`❌ Error sending attachment ${i + 1}:`, attachError.message);
            
            // Send error message to GHL conversation on exception
            try {
              if (contactId) {
                const errorMessage = `⚠️ Attachment delivery failed\n\nError: ${attachError.message || 'Unknown error'}\n\nPhone: ${phoneNumber}`;
                
                const errorPayload = {
                  type: "SMS",
                  conversationProviderId: ghlAccount.conversation_provider_id || getProviderId(),
                  contactId: contactId,
                  message: errorMessage,
                  direction: "inbound",
                  status: "delivered",
                  altId: `error_${Date.now()}`
                };
                
                const errorRes = await makeGHLRequest(`${BASE}/conversations/messages/inbound`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${validToken}`,
                    Version: "2021-07-28",
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify(errorPayload)
                }, ghlAccount);
                
                if (errorRes.ok) {
                  console.log(`✅ Error message sent to GHL conversation`);
                }
              }
            } catch (errorMsgError) {
              console.error(`❌ Error sending error message to GHL:`, errorMsgError.message);
            }
          }
        }
        
        if (!messageText) {
          return res.json({ status: 'success' });
        }
      }
      
      // Send text message if there's text and no attachments
      if (messageText && (!attachments || attachments.length === 0)) {
        console.log(`📤 Sending text message: ${messageText}`);
        console.log(`📤 Webhook Debug - Calling waManager.sendMessage with:`);
        console.log(`   - clientKey: ${clientKey}`);
        console.log(`   - phoneNumber: ${phoneNumber}`);
        console.log(`   - message: ${messageText}`);
        
        try {
          const sendResult = await waManager.sendMessage(clientKey, phoneNumber, messageText || '', 'text');
          console.log(`📤 Webhook Debug - Send Result:`, sendResult);
          
      if (sendResult && sendResult.status === 'skipped') {
            console.error(`❌ Message skipped: ${sendResult.reason}`);
            
            // Send error message to GHL conversation when message fails
            try {
              let errorMessage = '';
              if (sendResult.reason === 'Number does not have WhatsApp') {
                errorMessage = `⚠️ Message delivery failed\n\n❌ ${phoneNumber} does not have WhatsApp\n\n💡 Please verify the phone number or use another contact method.`;
              } else {
                errorMessage = `⚠️ Message delivery failed\n\nReason: ${sendResult.reason || 'Unknown error'}\n\nPhone: ${phoneNumber}`;
              }
              
              // Use conversationId from webhook if available, otherwise find from contactId
              let targetConversationId = conversationId;
              if (!targetConversationId && contactId) {
                try {
                  const convRes = await makeGHLRequest(`${BASE}/conversations/search?contactId=${contactId}`, {
                    method: 'GET',
                    headers: {
                      Authorization: `Bearer ${validToken}`,
                      Version: "2021-07-28",
                      "Content-Type": "application/json"
                    }
                  }, ghlAccount);
                  
                  if (convRes.ok) {
                    const convData = await convRes.json();
                    if (convData.conversations && convData.conversations.length > 0) {
                      targetConversationId = convData.conversations[0].id;
                    }
                  }
                } catch (convError) {
                  console.error(`❌ Error finding conversation:`, convError.message);
                }
              }
              
              // Send error message to GHL conversation
              if (contactId) {
                const errorPayload = {
                  type: "SMS",
                  conversationProviderId: ghlAccount.conversation_provider_id || getProviderId(),
            contactId: contactId,
                  message: errorMessage,
            direction: "inbound",
            status: "delivered",
                  altId: `error_${Date.now()}`
          };
          
                const errorRes = await makeGHLRequest(`${BASE}/conversations/messages/inbound`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${validToken}`,
              Version: "2021-07-28",
              "Content-Type": "application/json"
            },
                  body: JSON.stringify(errorPayload)
          }, ghlAccount);
          
                if (errorRes.ok) {
                  console.log(`✅ Error message sent to GHL conversation for contact: ${contactId}`);
                } else {
                  const errorText = await errorRes.text();
                  console.error(`❌ Failed to send error message to GHL:`, errorText);
                }
              }
            } catch (errorMsgError) {
              console.error(`❌ Error sending error message to GHL:`, errorMsgError.message);
        }
        
        return res.json({ 
          status: 'warning', 
          reason: sendResult.reason,
          phoneNumber: phoneNumber,
              sendResult: sendResult
        });
      }
      
      console.log('✅ Message sent successfully via Baileys');
          console.log('✅ Webhook Debug - Message delivery confirmed');
          
          // Track analytics for sent message
          await subaccountHelpers.incrementAnalytics(ghlAccount.id, ghlAccount.user_id, 'sent');
    } catch (sendError) {
          console.error(`❌ Error in waManager.sendMessage:`, sendError);
          console.error(`❌ Error stack:`, sendError.stack);
      
          // Send error message to GHL conversation on exception
      try {
            if (contactId) {
              const errorMessage = `⚠️ Message delivery failed\n\nError: ${sendError.message || 'Unknown error'}\n\nPhone: ${phoneNumber}`;
              
        const errorPayload = {
                type: "SMS",
                conversationProviderId: ghlAccount.conversation_provider_id || getProviderId(),
          contactId: contactId,
                message: errorMessage,
          direction: "inbound",
          status: "delivered",
          altId: `error_${Date.now()}`
        };
        
        const errorRes = await makeGHLRequest(`${BASE}/conversations/messages/inbound`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            Version: "2021-07-28",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(errorPayload)
        }, ghlAccount);
        
        if (errorRes.ok) {
                console.log(`✅ Error message sent to GHL conversation`);
        }
            }
          } catch (errorMsgError) {
            console.error(`❌ Error sending error message to GHL:`, errorMsgError.message);
      }
      
          throw sendError;
        }
      }
    } catch (sendError) {
      console.error('❌ Error sending message via Baileys:', sendError.message);
      return res.json({ 
        status: 'error', 
        error: sendError.message
      });
    }
    
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.json({ status: 'success' });
  }
});

// Global GHL Configuration
const BASE = "https://services.leadconnectorhq.com";
const HEADERS = {
  Authorization: `Bearer ${process.env.GHL_LOCATION_API_KEY}`,
  Version: "2021-07-28",
  "Content-Type": "application/json",
};

// Provider ID is now loaded from environment variables

// Validate environment variables on startup (optional)
function validateEnvironment() {
  // Only check for GHL_PROVIDER_ID, others are optional
  if (!process.env.GHL_PROVIDER_ID) {
    console.log('⚠️ GHL_PROVIDER_ID not set - will use fallback provider ID');
    return false;
  }
  
  console.log('✅ GHL_PROVIDER_ID found');
  return true;
}

// Get provider ID from environment (with fallback)
function getProviderId() {
  return process.env.GHL_PROVIDER_ID || null;
}

// WhatsApp message receiver webhook (for incoming WhatsApp messages)
app.post('/whatsapp/webhook', async (req, res) => {
  try {
    const { from, message, messageType = 'text', mediaUrl, mediaMessage, timestamp: messageTimestamp, sessionId, whatsappMsgId } = req.body;
    
    if (!from) {
      return res.json({ status: 'success' });
    }
    
    // Allow empty message for media messages
    if (!message && !mediaUrl && !mediaMessage) {
      return res.json({ status: 'success' });
    }
    
    // Deterministic mapping: phone → locationId → providerId → location_api_key
    const waNumber = from.replace('@s.whatsapp.net', '');
    const phone = "+" + waNumber; // E.164 format
    
    // Get GHL account from session or use first available
    let ghlAccount = null;
    if (sessionId) {
      const { data: session } = await supabaseAdmin
        .from('sessions')
        .select('*, ghl_accounts(*)')
        .eq('id', sessionId)
        .maybeSingle();
      
      if (session && session.ghl_accounts) {
        ghlAccount = session.ghl_accounts;
      }
    }
    
    // Fallback: Try to find GHL account by session ID pattern
    if (!ghlAccount && sessionId) {
      const sessionParts = sessionId.split('_');
      if (sessionParts.length >= 2) {
        const subaccountId = sessionParts[1];
        
        const { data: accountBySubaccount } = await supabaseAdmin
          .from('ghl_accounts')
          .select('*')
          .eq('id', subaccountId)
          .maybeSingle();
        
        if (accountBySubaccount) {
          ghlAccount = accountBySubaccount;
        }
      }
    }
    
    // Final fallback to any GHL account if still not found
    if (!ghlAccount) {
      const { data: anyAccount } = await supabaseAdmin
        .from('ghl_accounts')
        .select('*')
        .limit(1)
        .maybeSingle();
      
      if (anyAccount) {
        ghlAccount = anyAccount;
      }
    }
    
    if (!ghlAccount) {
      return res.json({ status: 'success' });
    }
    
    const locationId = ghlAccount.location_id;
    
    // Use account's conversation provider ID (more reliable)
    let providerId = ghlAccount.conversation_provider_id;
    if (!providerId) {
      providerId = getProviderId();
      if (!providerId) {
        return res.json({ status: 'error', message: 'Provider ID not available' });
      }
    }
    
    console.log(`📱 Processing WhatsApp message from: ${phone} for location: ${locationId}`);
    
    // Get valid token for this GHL account
    const validToken = await ensureValidToken(ghlAccount);
    
    // Check subaccount settings for contact creation toggle
    const settings = await subaccountHelpers.getSettings(ghlAccount.id);
    
    // Upsert contact (same location) - only if setting allows
    let contactId = null;
    
    if (settings.create_contact_in_ghl) {
      // Setting is ON - create/upsert contact
      try {
        const contactRes = await makeGHLRequest(`${BASE}/contacts/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            Version: "2021-07-28",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            phone: phone,
            name: phone,
            locationId: locationId
          })
        }, ghlAccount);
        
        if (contactRes.ok) {
          const contactData = await contactRes.json();
          contactId = contactData.contact?.id;
        } else {
          const errorText = await contactRes.text();
          
          // Try to extract contactId from error if it's a duplicate contact error
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.meta && errorJson.meta.contactId) {
              contactId = errorJson.meta.contactId;
            }
          } catch (parseError) {
            // Silent fail
          }
        }
      } catch (contactError) {
        // Silent fail
      }
    } else {
      // Setting is OFF - only sync if contact already exists
      // Use GET /contacts with filter to find existing contact
      try {
        // GHL Contacts API - get all contacts and filter by phone
        const listRes = await makeGHLRequest(`${BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(phone)}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${validToken}`,
            Version: "2021-07-28",
            "Content-Type": "application/json"
          }
        }, ghlAccount);
        
        if (listRes.ok) {
          const listData = await listRes.json();
          console.log(`🔍 Contact search result for ${phone}:`, listData);
          
          // Check if any contacts returned
          if (listData.contacts && listData.contacts.length > 0) {
            // Find contact with matching phone
            const matchingContact = listData.contacts.find(c => 
              c.phone === phone || 
              c.phone === phone.replace('+', '') ||
              c.phone === waNumber
            );
            
            if (matchingContact) {
              contactId = matchingContact.id;
              console.log(`✅ Found existing contact: ${contactId} for phone ${phone}`);
            } else {
              console.log(`⚠️ No exact phone match found in ${listData.contacts.length} results`);
            }
          } else {
            console.log(`⚠️ Contact not found in GHL for ${phone}`);
          }
        } else {
          const errorText = await listRes.text();
          console.log(`❌ Contact list failed:`, listRes.status, errorText);
        }
      } catch (searchError) {
        console.error('Contact search error:', searchError);
        // Silent fail - if search fails, assume contact doesn't exist
      }
    }
    
    // If no contactId found and setting is OFF, don't sync message
    if (!contactId) {
      console.log(`⏭️ Skipping message sync - contact creation disabled and contact not found for ${phone}`);
      // Still track analytics for received message
      await subaccountHelpers.incrementAnalytics(ghlAccount.id, ghlAccount.user_id, 'received');
      return res.json({ status: 'success', reason: 'contact_creation_disabled' });
    }
    
    // Track analytics for received message
    await subaccountHelpers.incrementAnalytics(ghlAccount.id, ghlAccount.user_id, 'received');
    
    // Add INBOUND message (Custom provider)
    try {
        let attachments = [];
        
        let finalMessage = message || "—";
        
        // If this is a media message, process and upload to GHL
        if (mediaUrl && (messageType === 'image' || messageType === 'voice' || messageType === 'video' || messageType === 'audio')) {
          console.log(`📎 Processing media message: ${messageType}`);
          
          try {
            // Get GHL access token
            const accessToken = await ensureValidToken(ghlAccount);
            
            let mediaBuffer;
            
            // Check if this is encrypted media that needs decryption
            if (mediaUrl === 'ENCRYPTED_MEDIA' && mediaMessage) {
              console.log(`🔓 Decrypting encrypted media with Baileys...`);
              
              // Get the WhatsApp client for this session
              const client = waManager.getClient(sessionId);
              if (!client || !client.socket) {
                throw new Error('WhatsApp client not available for decryption');
              }
              
              // Decrypt the media using Baileys
              try {
                // Try downloadContentFromMessage first (newer method)
                console.log(`🔄 Trying downloadContentFromMessage...`);
                const stream = await downloadContentFromMessage(mediaMessage, messageType);
                const chunks = [];
                for await (const chunk of stream) {
                  chunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(chunks);
                console.log(`✅ Decrypted ${mediaBuffer.length} bytes using downloadContentFromMessage`);
              } catch (downloadError) {
                console.error(`❌ downloadContentFromMessage failed:`, downloadError.message);
                
                // Fallback to downloadMediaMessage
                console.log(`🔄 Trying fallback method downloadMediaMessage...`);
                try {
                  mediaBuffer = await downloadMediaMessage(
                    mediaMessage,
                    'buffer',
                    {},
                    {
                      logger: console,
                      reuploadRequest: client.socket.updateMediaMessage
                    }
                  );
                  console.log(`✅ Decrypted ${mediaBuffer.length} bytes using downloadMediaMessage fallback`);
                } catch (decryptError) {
                  console.error(`❌ Media decryption failed:`, decryptError.message);
                  
                  // Try alternative approach - use the URL directly
                if (mediaMessage.message.audioMessage?.url) {
                  console.log(`🔄 Trying direct URL download as fallback...`);
                  const response = await fetch(mediaMessage.message.audioMessage.url);
                  if (response.ok) {
                    mediaBuffer = Buffer.from(await response.arrayBuffer());
                    console.log(`✅ Downloaded ${mediaBuffer.length} bytes via direct URL`);
                  } else {
                    throw new Error('Direct URL download also failed');
                  }
                } else {
                  throw decryptError;
                }
                }
              }
              
            } else if (mediaUrl && mediaUrl.includes('.enc')) {
              console.log(`🔓 Detected encrypted URL, trying direct download...`);
              // Try direct download first
              const response = await fetch(mediaUrl);
              if (response.ok) {
                mediaBuffer = Buffer.from(await response.arrayBuffer());
                console.log(`✅ Downloaded ${mediaBuffer.length} bytes`);
      } else {
                throw new Error('Failed to download encrypted media');
              }
            } else {
              // Regular URL download
              const response = await fetch(mediaUrl);
              if (response.ok) {
                mediaBuffer = Buffer.from(await response.arrayBuffer());
                console.log(`✅ Downloaded ${mediaBuffer.length} bytes`);
              } else {
                throw new Error('Failed to download media');
              }
            }
            
            // Upload media to GHL and get accessible URL
            try {
              const { uploadMediaToGHL } = require('./mediaHandler');
              const ghlResponse = await uploadMediaToGHL(
                mediaBuffer,
                messageType,
                contactId,
                validToken,
                locationId
              );
              
              console.log(`✅ Media uploaded to GHL successfully:`, ghlResponse);
              
              // Get the accessible media URL from GHL response
              const accessibleUrl = ghlResponse.url || 'Media URL not available';
              
              // Change 1: Send media as attachment, not as text message
              // Use a descriptive message and put URL in attachments array
              finalMessage = `🖼️ ${getMediaMessageText(messageType)}`;
              attachments.push(accessibleUrl);
              
              console.log(`📤 Sending ${messageType} as attachment: ${accessibleUrl}`);
              
            } catch (uploadError) {
              console.error(`❌ Media upload failed:`, uploadError.message);
              
              // Fallback: Send message with media URL as attachment
              if (mediaUrl && !mediaUrl.includes('ENCRYPTED')) {
                console.log(`🔄 Sending media URL as attachment instead...`);
                
      const payload = {
        type: "SMS",  // Changed to SMS for workflow triggers
        conversationProviderId: providerId,  // Required for workflows
        contactId: contactId,
        message: `🖼️ ${getMediaMessageText(messageType)}`,
        direction: "inbound",
        status: "delivered",
        altId: whatsappMsgId,
        attachments: [mediaUrl]  // Send URL directly as attachment
      };
      
      const inboundRes = await makeGHLRequest(`${BASE}/conversations/messages/inbound`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          Version: "2021-07-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }, ghlAccount);
      
      if (inboundRes.ok) {
                  console.log(`✅ Media URL sent as attachment to GHL`);
                  return res.json({ 
                    status: 'success', 
                    message: 'Media sent as URL attachment' 
                  });
                }
              }
              
              // If all fails, fall through to text notification
              throw uploadError;
            }
            
          } catch (error) {
            console.error(`❌ Media processing failed:`, error.message);
            
            // Fallback: Send text notification
            finalMessage = `📎 ${getMediaMessageText(messageType)}\n\n⚠️ Media could not be processed. Please check WhatsApp directly.`;
          }
        }
        
        // Change 2: Fix inbound message payload - add conversationProviderId and change type to SMS
        const payload = {
          type: "SMS",  // Changed from "WhatsApp" to "SMS" for workflow triggers
          conversationProviderId: providerId,  // Required for workflows
          contactId: contactId,
          message: finalMessage,
          direction: "inbound",
          status: "delivered",
          altId: whatsappMsgId || `wa_${Date.now()}` // idempotency
        };
        
        // Only add attachments field if attachments exist and are not empty
        // GHL rejects empty arrays, so don't include the field at all if empty
        if (attachments && attachments.length > 0) {
          payload.attachments = attachments;
        }
      
      console.log(`📤 Sending to GHL SMS Provider:`, {
        type: payload.type,
        conversationProviderId: payload.conversationProviderId,
        contactId: payload.contactId,
        message: payload.message,
        direction: payload.direction,
        status: payload.status,
        altId: payload.altId
      });
      
      // Send message directly to GHL (working approach)
      const inboundRes = await makeGHLRequest(`${BASE}/conversations/messages/inbound`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          Version: "2021-07-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }, ghlAccount);
      
      if (inboundRes.ok) {
        const responseData = await inboundRes.json();
        console.log(`✅ Inbound message added to GHL conversation for contact: ${contactId}`);
        console.log(`📊 GHL Response:`, JSON.stringify(responseData, null, 2));
        
        // Trigger customer_replied workflow via webhook (silent)
        try {
          const workflowPayload = {
            event_type: "customer_replied",
            contact_id: contactId,
            contact_name: "Customer",
            contact_phone: phone,
            last_message: finalMessage,
            location_id: locationId,
            channel: "sms",
            conversation_provider_id: providerId,
            timestamp: new Date().toISOString()
          };
          
          await fetch(`${process.env.BACKEND_URL || 'https://api.octendr.com'}/api/ghl-workflow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(workflowPayload)
          });
        } catch (workflowError) {
          // Silent fail
        }
        
        // Store message in local database
        try {
          // Get session info for database storage
          let sessionData = null;
          if (sessionId) {
            const { data: session } = await supabaseAdmin
              .from('sessions')
              .select('*, subaccounts(*)')
              .eq('id', sessionId)
              .maybeSingle();
            
            if (session) {
              sessionData = session;
            }
          }
          
          // If no session found, try to find by GHL account
          if (!sessionData && ghlAccount) {
            const { data: session } = await supabaseAdmin
              .from('sessions')
              .select('*, subaccounts(*)')
              .eq('subaccount_id', ghlAccount.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (session) {
              sessionData = session;
            }
          }
          
          if (sessionData) {
            // Extract phone numbers
            const fromNumber = phone.replace('+', '');
            const toNumber = sessionData.phone_number || 'unknown';
            
            // Store in local messages table (silent)
            await supabaseAdmin
              .from('messages')
              .insert({
                session_id: sessionData.id,
                user_id: sessionData.user_id,
                subaccount_id: sessionData.subaccount_id,
                from_number: fromNumber,
                to_number: toNumber,
                body: finalMessage,
                media_url: mediaUrl,
                media_mime: messageType,
                direction: 'in',
                created_at: new Date().toISOString()
              });
          }
        } catch (dbError) {
          // Silent fail
        }

        // Note: Team notifications are now handled by GHL workflows
        // The workflow will call /api/team-notification endpoint with proper team members
        
        // Track this message to prevent echo
        if (!global.recentInboundMessages) {
          global.recentInboundMessages = new Set();
        }
        const messageKey = `${contactId}_${message}`;
        global.recentInboundMessages.add(messageKey);
        setTimeout(() => {
          global.recentInboundMessages.delete(messageKey);
        }, 10000); // 10 seconds
      } else {
        const errorText = await inboundRes.text();
        console.error(`❌ Failed to add inbound message to GHL:`, errorText);
        console.error(`📊 Status Code:`, inboundRes.status);
        console.error(`📊 Headers:`, Object.fromEntries(inboundRes.headers.entries()));
      }
    } catch (inboundError) {
      console.error(`❌ Error adding inbound message to GHL:`, inboundError);
    }
    
    // IMPORTANT: Yahan WhatsApp ko kuch wapas send na karein (no echo)
    
    res.json({ status: 'success' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.json({ status: 'success' });
  }
});

// GHL Provider Send Message (Legacy endpoint - keep for compatibility)
app.post('/ghl/provider/send', async (req, res) => {
  try {
    const { to, message, locationId } = req.body;
    console.log('GHL Send Message:', { to, message, locationId });

    // Find session for this location
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found' });
    }

    // Find active session
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount.id)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return res.status(404).json({ error: 'No active WhatsApp session found' });
    }

    // Send message via WhatsApp - use consistent key format
    const cleanSubaccountId = session.subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const clientKey = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    
    console.log(`🔍 Looking for WhatsApp client with key: ${clientKey}`);
    const clientStatus = waManager.getClientStatus(clientKey);
    
    if (clientStatus && (clientStatus.status === 'connected' || clientStatus.status === 'connecting')) {
      const messageText = text || message || 'Hello from GHL!';
      const msgType = messageType || 'text';
      const media = mediaUrl || null;
      
      console.log(`✅ Sending WhatsApp ${msgType} to ${to}: ${messageText}`);
      if (media) {
        console.log(`📎 Media URL: ${media}`);
      }
      await waManager.sendMessage(clientKey, to, messageText, msgType, media);
      res.json({ status: 'success', messageId: Date.now().toString() });
    } else {
      console.error(`❌ WhatsApp client not found or not ready for key: ${clientKey}, status: ${clientStatus?.status}`);
      console.log(`📋 Available clients:`, waManager.getAllClients().map(c => c.sessionId));
      res.status(500).json({ 
        error: 'WhatsApp client not available', 
        status: clientStatus?.status || 'not found',
        message: 'Please scan QR code or wait for connection'
      });
    }
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GHL Provider Status
app.get('/ghl/provider/status', async (req, res) => {
  try {
    const { locationId } = req.query;
    
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    if (!ghlAccount) {
      return res.json({ status: 'disconnected', message: 'GHL account not found' });
    }

    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return res.json({ status: 'disconnected', message: 'No session found' });
    }

    res.json({ 
      status: session.status,
      phone_number: session.phone_number,
      message: session.status === 'ready' ? 'Connected' : 'Not connected'
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// GHL Provider UI (for custom menu link)
app.get('/ghl/provider', async (req, res) => {
  try {
    // Set specific headers for iframe embedding - Permanent solution for whitelabel domains
    // Allow all origins to support any whitelabel domain (required for GHL whitelabel functionality)
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    let { locationId, companyId } = req.query;
    
    // 🔥 CRITICAL: Try to extract locationId from referer URL FIRST (GHL context)
    // This is the PRIMARY source - URL se jo locationId aaye, wahi use karo
    if (!locationId) {
      const referer = req.get('referer') || '';
      console.log('🔍 Checking referer URL for locationId:', referer);
      
      // Extract locationId from GHL URLs like: 
      // https://app.gohighlevel.com/v2/location/5iODXOPij0pdXOyIEIQi/custom-menu-link/...
      // https://app.gohighlevel.com/locations/LOCATION_ID/...
      // https://app.gohighlevel.com/location/LOCATION_ID/...
      const locationPatterns = [
        /\/v2\/location\/([a-zA-Z0-9_-]+)/,    // v2/location/LOCATION_ID pattern (PRIORITY)
        /\/location\/([a-zA-Z0-9_-]+)/,        // location/LOCATION_ID pattern
        /\/locations\/([a-zA-Z0-9_-]+)/        // locations/LOCATION_ID pattern
      ];
      
      for (const pattern of locationPatterns) {
        const locationMatch = referer.match(pattern);
        if (locationMatch && locationMatch[1]) {
          locationId = locationMatch[1];
          console.log('✅✅✅ Found locationId from referer URL:', locationId);
          console.log('   Matched pattern:', pattern.toString());
          console.log('   Full referer:', referer);
          break; // Use first match and stop
        }
      }
      
      if (!locationId) {
        console.log('⚠️ Could not extract locationId from referer:', referer);
      }
    }
    
    // Try to get from GHL headers if available
    if (!locationId) {
      const ghlLocationId = req.get('x-location-id') || req.get('location-id');
      if (ghlLocationId) {
        locationId = ghlLocationId;
        console.log('✅ Found locationId from header:', locationId);
      }
    }
    
    // If no locationId provided, try to detect from GHL context or company
    if (!locationId && companyId) {
      console.log('No locationId provided, looking up by companyId:', companyId);
      
      // Find GHL account by company_id
      const { data: ghlAccount } = await supabaseAdmin
        .from('ghl_accounts')
        .select('location_id')
        .eq('company_id', companyId)
        .maybeSingle();
        
      if (ghlAccount && ghlAccount.location_id) {
        locationId = ghlAccount.location_id;
        console.log('✅ Found locationId from company:', locationId);
      }
    }
    
    // 🚫 REMOVED: Don't use first available account as fallback - this causes wrong location!
    // User must provide locationId or it should be detected from context
    
    if (!locationId) {
      return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>WhatsApp Setup - Octendr</title>
          <style>
            * { box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              padding: 40px 20px;
              margin: 0;
              background: linear-gradient(135deg, #128C7E 0%, #075E54 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 20px;
              padding: 40px;
              max-width: 600px;
              width: 100%;
              box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
            }
            h1 { color: #075E54; margin-top: 0; }
            .code-block {
              background: #f5f5f5;
              padding: 15px;
              border-radius: 10px;
              font-family: 'Courier New', monospace;
              margin: 20px 0;
              word-break: break-all;
              border: 2px solid #25D366;
            }
            .step { margin: 20px 0; padding-left: 30px; position: relative; }
            .step::before {
              content: counter(step);
              counter-increment: step;
              position: absolute;
              left: 0;
              background: #25D366;
              color: white;
              width: 25px;
              height: 25px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
            }
            ol { counter-reset: step; list-style: none; padding: 0; }
            .highlight { color: #25D366; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 WhatsApp Connection Setup</h1>
            <p>To connect WhatsApp, please add your Location ID to the link:</p>
            
            <div class="code-block">
              ${process.env.BACKEND_URL || 'https://api.octendr.com'}/ghl/provider?locationId=YOUR_LOCATION_ID
            </div>
            
            <ol>
              <li class="step">
                Go to <span class="highlight">GoHighLevel Dashboard</span>
              </li>
              <li class="step">
                Navigate to <span class="highlight">Settings → General</span>
              </li>
              <li class="step">
                Copy your <span class="highlight">Location ID</span>
              </li>
              <li class="step">
                Replace <span class="highlight">YOUR_LOCATION_ID</span> in the link above
              </li>
              <li class="step">
                Add this link to your <span class="highlight">Custom Menu</span>
              </li>
            </ol>
            
            <p style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #E9EDEF; color: #54656F;">
              <strong>Or use the universal link:</strong><br>
              <div class="code-block" style="margin-top: 10px;">
                ${process.env.BACKEND_URL || 'https://api.octendr.com'}/ghl/provider
              </div>
              This will automatically detect your location when opened from GHL.
            </p>
          </div>
        </body>
      </html>
      `);
    }

    // Get subaccount name and connected phone number
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount?.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const subaccountName = ghlAccount ? `Location ${locationId}` : `Location ${locationId}`;
    const connectedNumber = session?.phone_number || null;
    
    // Replace template variables in HTML
    const htmlContent = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>WhatsApp Provider - ${subaccountName}</title>
          <style>
            * {
              box-sizing: border-box;
            }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
              padding: 0; 
              margin: 0;
              background: linear-gradient(135deg, #128C7E 0%, #075E54 50%, #25D366 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container { 
              max-width: 1200px;
              width: 95%;
              margin: 20px auto;
            }
            .card { 
              background: white; 
              border-radius: 20px; 
              padding: 0;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
              overflow: hidden;
            }
            .header {
              background: linear-gradient(135deg, #075E54 0%, #128C7E 100%);
              padding: 30px 40px;
              color: white;
              display: flex;
              align-items: center;
              gap: 20px;
            }
            .logo {
              width: 70px;
              height: 70px;
              background: white;
              border-radius: 18px;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .logo svg {
              width: 50px;
              height: 50px;
            }
            .header-text {
              flex: 1;
            }
            .title {
              font-size: 32px;
              font-weight: 700;
              margin: 0 0 8px 0;
              letter-spacing: -0.5px;
            }
            .subtitle {
              font-size: 16px;
              margin: 0;
              opacity: 0.95;
            }
            .content-wrapper {
              display: grid;
              grid-template-columns: 1fr 1.2fr;
              gap: 0;
              min-height: 500px;
            }
            .left-panel {
              background: #F0F2F5;
              padding: 40px;
              display: flex;
              flex-direction: column;
              justify-content: center;
            }
            .right-panel {
              padding: 40px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
            }
            .info-section {
              background: white;
              border-radius: 12px;
              padding: 24px;
              margin-bottom: 24px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            .info-section h3 {
              margin: 0 0 16px 0;
              color: #075E54;
              font-size: 18px;
              font-weight: 600;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 0;
              border-bottom: 1px solid #E9EDEF;
            }
            .info-row:last-child {
              border-bottom: none;
            }
            .info-label {
              font-weight: 600;
              color: #54656F;
              font-size: 14px;
            }
            .info-value {
              color: #111B21;
              font-family: 'Courier New', monospace;
              font-size: 13px;
            }
            .connected-number {
              color: #25D366;
              font-weight: 700;
              font-size: 16px;
            }
            .qr-section {
              text-align: center;
            }
            .qr-container {
              background: white;
              border: 3px solid #25D366;
              border-radius: 16px;
              padding: 24px;
              display: inline-block;
              box-shadow: 0 4px 12px rgba(37, 211, 102, 0.15);
            }
            .qr-container img {
              width: 280px;
              height: 280px;
              display: block;
            }
            .status {
              margin: 20px 0;
              padding: 16px 24px;
              border-radius: 12px;
              font-weight: 600;
              font-size: 15px;
              display: inline-flex;
              align-items: center;
              gap: 12px;
            }
            .status.initializing {
              background: #E3F2FD;
              color: #1565C0;
              border: 2px solid #90CAF9;
            }
            .status.qr {
              background: #FFF3E0;
              color: #E65100;
              border: 2px solid #FFB74D;
            }
            .status.ready {
              background: #E8F5E9;
              color: #2E7D32;
              border: 2px solid #81C784;
            }
            .status.disconnected {
              background: #FFEBEE;
              color: #C62828;
              border: 2px solid #E57373;
            }
            .instructions {
              background: white;
              border: 2px solid #25D366;
              border-radius: 12px;
              padding: 24px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            .instructions h3 {
              color: #075E54;
              margin: 0 0 16px 0;
              font-size: 18px;
              font-weight: 600;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .instructions ol {
              color: #111B21;
              margin: 0;
              padding-left: 24px;
              line-height: 1.8;
            }
            .instructions li {
              margin: 12px 0;
              font-size: 15px;
            }
            .instructions strong {
              color: #075E54;
            }
            .warning-box {
              background: #FFF8E1;
              border-left: 4px solid #FFA000;
              padding: 16px;
              margin-top: 16px;
              border-radius: 8px;
              font-size: 14px;
              color: #E65100;
              line-height: 1.6;
            }
            .warning-box strong {
              display: block;
              margin-bottom: 8px;
              color: #E65100;
            }
            .button-group {
              display: flex;
              gap: 12px;
              justify-content: center;
              margin-top: 32px;
              flex-wrap: wrap;
            }
            button { 
              padding: 14px 28px; 
              border-radius: 10px; 
              border: none; 
              font-weight: 600;
              font-size: 15px;
              cursor: pointer;
              transition: all 0.3s ease;
              display: inline-flex;
              align-items: center;
              gap: 8px;
            }
            .btn-primary {
              background: #25D366;
              color: white;
            }
            .btn-primary:hover {
              background: #1DA851;
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
            }
            .btn-secondary {
              background: #F0F2F5;
              color: #54656F;
              border: 2px solid #E9EDEF;
            }
            .btn-secondary:hover {
              background: #E9EDEF;
              transform: translateY(-2px);
            }
            .btn-success {
              background: #075E54;
              color: white;
            }
            .btn-success:hover {
              background: #054A42;
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(7, 94, 84, 0.4);
            }
            .loading {
              display: inline-block;
              width: 20px;
              height: 20px;
              border: 3px solid rgba(255,255,255,0.3);
              border-top: 3px solid white;
              border-radius: 50%;
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            @media (max-width: 968px) {
              .content-wrapper {
                grid-template-columns: 1fr;
              }
              .left-panel {
                order: 2;
              }
              .right-panel {
                order: 1;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <div class="logo">
                  <svg viewBox="0 0 175.216 175.552" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="whatsapp-gradient" x1="50%" y1="0%" x2="50%" y2="100%">
                        <stop offset="0%" style="stop-color:#25D366" />
                        <stop offset="100%" style="stop-color:#128C7E" />
                      </linearGradient>
                    </defs>
                    <path fill="url(#whatsapp-gradient)" d="M87.184.003C39.065.003 0 39.068 0 87.187c0 15.435 4.023 29.892 11.068 42.455L3.873 171.55l43.405-11.374c12.006 6.521 25.764 10.246 40.316 10.246 48.12 0 87.185-39.065 87.185-87.185C174.78 39.068 135.715.003 87.184.003zm50.964 123.17c-2.046 5.766-10.152 10.548-16.608 11.93-4.423.927-10.194 1.677-29.608-6.364-24.828-10.28-40.901-35.496-42.142-37.126-1.24-1.63-10.163-13.522-10.163-25.796 0-12.274 6.438-18.292 8.724-20.782 2.285-2.49 4.99-3.114 6.652-3.114 1.663 0 3.326.016 4.778.087 1.53.075 3.585-.581 5.603 4.269 2.046 4.923 6.963 16.986 7.572 18.217.609 1.231.203 2.663-.406 3.894-.609 1.231-1.218 2.138-2.458 3.37-1.24 1.23-2.603 2.748-3.717 3.69-1.24 1.051-2.533 2.19-1.088 4.292 1.445 2.102 6.417 10.602 13.782 17.162 9.463 8.434 17.444 11.057 19.912 12.288 2.468 1.231 3.907.986 5.353-.609 1.445-1.595 6.219-7.266 7.88-9.757 1.662-2.49 3.325-2.084 5.61-1.247 2.286.837 14.56 6.87 17.047 8.116 2.488 1.247 4.153 1.863 4.762 2.906.609 1.043.609 6.006-1.437 11.772z"/>
                  </svg>
                </div>
                <div class="header-text">
                  <h1 class="title">WhatsApp Business Integration</h1>
                  <p class="subtitle">Connect your WhatsApp to GoHighLevel SMS Provider</p>
                </div>
              </div>

              <div class="content-wrapper">
                <div class="left-panel">
              <div class="info-section">
                    <h3>📊 Connection Details</h3>
                <div class="info-row">
                  <span class="info-label">Subaccount:</span>
                  <span class="info-value">${subaccountName}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Location ID:</span>
                  <span class="info-value">${locationId}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Status:</span>
                  <span class="info-value" id="status-text">Checking...</span>
                </div>
                <div class="info-row" id="phone-row" style="display: none;">
                  <span class="info-label">Connected Number:</span>
                  <span class="info-value connected-number" id="phone-number"></span>
                </div>
              </div>

                  <div class="instructions">
                    <h3>📱 How to Connect WhatsApp:</h3>
                    <ol>
                      <li><strong>Open WhatsApp</strong> on your phone</li>
                      <li><strong>Tap Menu</strong> (⋮) → <strong>Linked Devices</strong></li>
                      <li><strong>Tap "Link a Device"</strong></li>
                      <li><strong>Scan the QR Code</strong> shown on the right</li>
                      <li><strong>Wait patiently</strong> for connection to complete (30-60 seconds)</li>
                      <li><strong>Don't close</strong> this window until "Connected" appears</li>
                    </ol>
                    
                    <div class="warning-box">
                      <strong>⚠️ Important Notes:</strong>
                      After scanning, please wait for the connection to fully establish. The status will change to "Connected" when ready. 
                      <br><br>
                      <strong>If connection takes too long (5+ minutes):</strong>
                      <br>
                      1. Delete this subaccount from your dashboard
                      <br>
                      2. Add the subaccount again
                      <br>
                      3. Scan the new QR code immediately
                    </div>
                </div>

                  <div class="button-group">
                    <button id="reset" class="btn-secondary">🔄 Reset QR</button>
                    <button id="refresh" class="btn-primary">🔄 Refresh Status</button>
                    <button id="close" class="btn-success" style="display: none;">✅ Close Window</button>
                  </div>
                </div>

                <div class="right-panel">
                  <div class="qr-section">
                <!-- QR Code Section -->
                <div id="qr" class="qr-container" style="display: none;">
                  <div id="qr-image"></div>
                </div>

                <div id="status" class="status initializing">
                  <div class="loading"></div> Preparing WhatsApp session...
                </div>
              </div>
              </div>
              </div>
            </div>
          </div>
          <script>
            const qs = new URLSearchParams(window.location.search);
            // Get locationId from URL parameter OR from embedded value
            const locId = qs.get('locationId') || '${locationId}';
            const companyId = qs.get('companyId');
            
            // Get DOM elements
            const statusEl = document.getElementById('status');
            const statusTextEl = document.getElementById('status-text');
            const qrEl = document.getElementById('qr');
            const qrImageEl = document.getElementById('qr-image');
            const phoneRowEl = document.getElementById('phone-row');
            const phoneNumberEl = document.getElementById('phone-number');
            const resetBtn = document.getElementById('reset');
            const refreshBtn = document.getElementById('refresh');
            const closeBtn = document.getElementById('close');

            function updateStatus(status, phoneNumber = null) {
              // Update status text
              statusTextEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
              
              // Update status element
              statusEl.className = 'status ' + status;
              
              switch(status) {
                case 'initializing':
                  statusEl.innerHTML = '<div class="loading"></div> <strong>Initializing...</strong><br><small>Setting up your WhatsApp connection</small>';
                  qrEl.style.display = 'none';
                  phoneRowEl.style.display = 'none';
                  closeBtn.style.display = 'none';
                  break;
                  
                case 'qr':
                  statusEl.innerHTML = '📱 <strong>Ready to Scan</strong><br><small>Please scan the QR code with your WhatsApp app</small>';
                  phoneRowEl.style.display = 'none';
                  closeBtn.style.display = 'none';
                  qrEl.style.display = 'block';
                  break;
                  
                case 'ready':
                  statusEl.innerHTML = '✅ <strong>Connected Successfully!</strong><br><small>Your WhatsApp is now linked and ready to use</small>';
                  qrEl.style.display = 'none';
                  phoneRowEl.style.display = 'flex';
                  phoneNumberEl.textContent = phoneNumber || 'Unknown';
                  closeBtn.style.display = 'inline-flex';
                  break;
                  
                case 'disconnected':
                  statusEl.innerHTML = '❌ <strong>Connection Lost</strong><br><small>Please refresh and scan the QR code again</small>';
                  qrEl.style.display = 'none';
                  phoneRowEl.style.display = 'none';
                  closeBtn.style.display = 'none';
                  break;
                  
                default:
                  statusEl.innerHTML = '⚠️ <strong>Unknown Status</strong><br><small>Current state: ' + status + '</small>';
                  qrEl.style.display = 'none';
                  phoneRowEl.style.display = 'none';
                  closeBtn.style.display = 'none';
              }
            }

            async function create() {
              try {
                updateStatus('initializing');
                const r = await fetch('/ghl/location/' + encodeURIComponent(locId) + '/session' + (companyId ? ('?companyId=' + encodeURIComponent(companyId)) : ''), { method: 'POST' });
                const j = await r.json().catch(() => ({}));
                
                if (j.qr) {
                  qrImageEl.innerHTML = '<img src="' + j.qr + '" alt="QR Code" />';
                  updateStatus('qr');
                } else {
                  updateStatus(j.status || 'error');
                }
              } catch (e) {
                console.error('Create session error:', e);
                updateStatus('error');
              }
            }

            async function poll() {
              try {
                const r = await fetch('/ghl/location/' + encodeURIComponent(locId) + '/session');
                const j = await r.json().catch(() => ({}));
                
                if (j.qr) {
                  qrImageEl.innerHTML = '<img src="' + j.qr + '" alt="QR Code" />';
                  updateStatus('qr');
                } else {
                  updateStatus(j.status || 'unknown', j.phone_number);
                }
                
                // Stop polling if connected or disconnected
                if (j.status === 'ready' || j.status === 'disconnected') {
                  clearInterval(pollInterval);
                }
              } catch (e) {
                console.error('Poll error:', e);
                updateStatus('error');
              }
            }

            let pollInterval = setInterval(poll, 3000); // Poll every 3 seconds

            // Event listeners
            resetBtn.addEventListener('click', async () => {
              clearInterval(pollInterval);
              await create();
              pollInterval = setInterval(poll, 3000);
            });

            refreshBtn.addEventListener('click', () => {
              poll();
            });

            closeBtn.addEventListener('click', () => {
              window.close();
            });

            // Initialize
            (async () => {
              await create();
              poll();
            })();
          </script>
        </body>
      </html>
    `;
    
    res.send(htmlContent.replace(/\{locationId\}/g, locationId).replace(/\{subaccountName\}/g, subaccountName).replace(/\{connectedNumber\}/g, connectedNumber || 'Not connected'));
  } catch (error) {
    console.error('Provider UI error:', error);
    res.status(500).send('Failed to render provider');
  }
});

// Get GHL account status
app.get('/admin/ghl/account-status', async (req, res) => {
  try {
    // Get user from JWT cookie
    const token = req.cookies?.auth_token;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const jwt = require('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    let userId = null;
    
      try {
      const decoded = jwt.verify(token, jwtSecret);
      userId = decoded.userId;
      } catch (e) {
      console.log('JWT validation failed:', e.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Get GHL account for this user
    const { data: ghlAccount, error: ghlError } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
      
    console.log('Account status check:', { userId, ghlAccount: !!ghlAccount, error: ghlError });

    res.json({ 
      account: ghlAccount,
      error: ghlError,
      connected: !!ghlAccount
    });
    
  } catch (error) {
    console.error('Error checking account status:', error);
    res.status(500).json({ error: 'Failed to check account status' });
  }
});

// Get locations from GHL API
app.get('/admin/ghl/locations', async (req, res) => {
  try {
    // Get user from JWT cookie
    const token = req.cookies?.auth_token;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const jwt = require('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    let userId = null;
    
    try {
      const decoded = jwt.verify(token, jwtSecret);
      userId = decoded.userId;
    } catch (e) {
      console.log('JWT validation failed:', e.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Get ALL GHL accounts for this user (agency + subaccounts)
    const { data: ghlAccounts, error: ghlError } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (ghlError || !ghlAccounts || ghlAccounts.length === 0) {
      console.error('GHL account lookup error:', ghlError);
      return res.status(404).json({ error: 'GHL account not found. Please connect your GHL account first.' });
    }
    
    console.log(`📊 Found ${ghlAccounts.length} GHL account(s) for user ${userId}`);
    
    let allLocations = [];
    
    // Process each GHL account
    for (const account of ghlAccounts) {
      console.log(`🔍 Processing account - Location ID: ${account.location_id}, Company ID: ${account.company_id}`);
      
      // Check if this is an agency-level account (has company_id but no specific location_id, or location_id matches company_id)
      const isAgencyAccount = account.company_id && (!account.location_id || account.location_id === account.company_id);
      
      if (isAgencyAccount) {
        // Agency level - fetch all locations under this company
        console.log(`🏢 Agency account detected for company: ${account.company_id}`);
        
        try {
          const ghlResponse = await fetch('https://services.leadconnectorhq.com/locations/', {
            headers: {
              'Authorization': `Bearer ${account.access_token}`,
              'Version': '2021-07-28'
            }
          });
          
          if (ghlResponse.ok) {
            const ghlData = await ghlResponse.json();
            console.log(`✅ Fetched ${ghlData.locations?.length || 0} locations from agency account`);
            
            if (ghlData.locations && Array.isArray(ghlData.locations)) {
              // Add source info to each location
              const locationsWithSource = ghlData.locations.map(loc => ({
                ...loc,
                source: 'agency',
                companyId: account.company_id
              }));
              allLocations.push(...locationsWithSource);
            }
          } else {
            console.log(`⚠️ Failed to fetch agency locations: ${ghlResponse.status}`);
          }
        } catch (error) {
          console.error('❌ Error fetching agency locations:', error);
        }
      } else if (account.location_id) {
        // Specific location/subaccount
        console.log(`📍 Subaccount detected for location: ${account.location_id}`);
        
        // Check if this location is already in the list (might be from agency fetch)
        const existingLocation = allLocations.find(loc => loc.id === account.location_id);
        
        if (!existingLocation) {
          // Fetch specific location details
          try {
            const ghlResponse = await fetch(`https://services.leadconnectorhq.com/locations/${account.location_id}`, {
              headers: {
                'Authorization': `Bearer ${account.access_token}`,
                'Version': '2021-07-28'
              }
            });
            
            if (ghlResponse.ok) {
              const locationData = await ghlResponse.json();
              console.log(`✅ Fetched location details: ${locationData.name || account.location_id}`);
              
              allLocations.push({
                ...locationData,
                source: 'subaccount',
                companyId: account.company_id
              });
            } else {
              // Fallback if API call fails
              console.log(`⚠️ Failed to fetch location details, using fallback`);
              allLocations.push({
                id: account.location_id,
                name: `Location ${account.location_id}`,
                source: 'subaccount',
                companyId: account.company_id
              });
            }
          } catch (error) {
            console.error('❌ Error fetching location details:', error);
            // Add basic location info as fallback
            allLocations.push({
              id: account.location_id,
              name: `Location ${account.location_id}`,
              source: 'subaccount',
              companyId: account.company_id
            });
          }
        }
      }
    }
    
    // Remove duplicates based on location ID
    const uniqueLocations = Array.from(
      new Map(allLocations.map(loc => [loc.id, loc])).values()
    );
    
    console.log(`✅ Returning ${uniqueLocations.length} unique location(s)`);
    
    res.json({
      locations: uniqueLocations,
      totalAccounts: ghlAccounts.length
    });

  } catch (error) {
    console.error('Error fetching GHL locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations', details: error.message });
  }
});

// Session management endpoints
app.post('/ghl/location/:locationId/session', async (req, res) => {
  try {
    const { locationId } = req.params;
    const { companyId } = req.query;

    console.log(`Creating session for locationId: ${locationId}`);

    // Find GHL account - try by location_id first, then fallback to any account
    let ghlAccount = null;
    
    // First try to find account with matching location_id
    const { data: accountByLocation } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();
    
    if (accountByLocation) {
      ghlAccount = accountByLocation;
      console.log('Found GHL account by location_id:', locationId);
    } else {
      // Fallback: use any GHL account if location_id doesn't match
      const { data: anyAccount } = await supabaseAdmin
        .from('ghl_accounts')
      .select('*')
        .limit(1)
        .maybeSingle();
      
      if (anyAccount) {
        ghlAccount = anyAccount;
        console.log('Using fallback GHL account for location:', locationId);
      }
    }

    if (!ghlAccount) {
      console.error(`No GHL account found in database`);
      return res.status(404).json({ error: 'GHL account not found. Please connect GHL account first.' });
    }

    console.log('Using GHL account:', { id: ghlAccount.id, user_id: ghlAccount.user_id, company_id: ghlAccount.company_id, location_id: ghlAccount.location_id });

    // Remove this line since location_id might not exist

    // Check for existing session for this user/location combination
    // Use locationId as a unique identifier for the session
    const { data: existing } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('user_id', ghlAccount.user_id)
      .eq('subaccount_id', ghlAccount.id) // Use ghl_account ID as reference
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0 && existing[0].status !== 'disconnected') {
      console.log(`📋 Found existing session: ${existing[0].id}, status: ${existing[0].status}`);
      
      // If session exists but not connected, try to restore the client
      if (existing[0].status === 'ready' || existing[0].status === 'qr') {
        const cleanSubaccountId = existing[0].subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sessionName = `location_${cleanSubaccountId}_${existing[0].id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        
        console.log(`🔄 Attempting to restore client for existing session: ${sessionName}`);
        
        // Try to restore the client
        try {
          await waManager.createClient(sessionName);
          console.log(`✅ Client restored for existing session: ${sessionName}`);
        } catch (error) {
          console.error(`❌ Failed to restore client for existing session:`, error);
        }
      }
      
      return res.json({ 
        status: existing[0].status, 
        qr: existing[0].qr, 
        phone_number: existing[0].phone_number,
        session_id: existing[0].id
      });
    }

    // Create new session - let database generate UUID automatically
    // Use ghl_account.id as subaccount_id (no need for separate subaccounts table)
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: ghlAccount.user_id, 
        subaccount_id: ghlAccount.id, // Use ghl_account ID directly
        status: 'initializing'
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to create session' });
    }

    console.log('Created session:', session.id);
    console.log('Session details:', { 
      id: session.id, 
      user_id: session.user_id, 
      subaccount_id: session.subaccount_id, 
      status: session.status 
    });

    // Verify session was saved to database
    const { data: verifySession, error: verifyError } = await supabaseAdmin
            .from('sessions')
      .select('*')
      .eq('id', session.id)
      .single();

    if (verifyError) {
      console.error('Session verification failed:', verifyError);
    } else {
      console.log('Session verified in database:', verifySession);
    }

    // Create WhatsApp client with subaccount-specific session name (clean format)
    const cleanSubaccountId = session.subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionName = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    
    // Add timeout for WhatsApp client initialization
    const initTimeout = setTimeout(async () => {
        try {
          await supabaseAdmin
            .from('sessions')
          .update({ status: 'disconnected' })
            .eq('id', session.id);
        console.log(`WhatsApp initialization timeout for location ${locationId}`);
      } catch (e) {
        console.error('Timeout update error:', e);
      }
    }, 300000); // 300 seconds timeout (5 minutes for WhatsApp connection)

    console.log(`Creating Baileys client with sessionName: ${sessionName}`);
    
    // Create Baileys client
    try {
      const client = await waManager.createClient(sessionName);
      console.log(`✅ Baileys client created for session: ${sessionName}`);
      
      // Wait a moment for QR to be generated
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if QR is already available
      const qrCode = await waManager.getQRCode(sessionName);
      if (qrCode) {
        console.log(`📱 QR already available, updating database immediately...`);
        const qrDataUrl = await qrcode.toDataURL(qrCode);
          await supabaseAdmin
            .from('sessions')
          .update({ qr: qrDataUrl, status: 'qr' })
            .eq('id', session.id);
        console.log(`✅ QR updated in database immediately`);
      }
        } catch (error) {
        console.error(`❌ Failed to create Baileys client:`, error);
      return res.status(500).json({ error: 'Failed to create WhatsApp client' });
    }
    
    // Set up QR code polling
    const qrPolling = setInterval(async () => {
      try {
        console.log(`🔍 Checking for QR code for session: ${sessionName}`);
        const qrCode = await waManager.getQRCode(sessionName);
        console.log(`📱 QR code result:`, qrCode ? 'Found' : 'Not found');
        
        if (qrCode) {
          clearTimeout(initTimeout); // Clear timeout when QR is generated
          console.log(`🔄 Converting QR to data URL...`);
          const qrDataUrl = await qrcode.toDataURL(qrCode);
          console.log(`💾 Saving QR to database...`);
          
          const { error: qrUpdateError } = await supabaseAdmin
            .from('sessions')
            .update({ qr: qrDataUrl, status: 'qr' })
            .eq('id', session.id);
          
          if (qrUpdateError) {
            console.error('❌ QR update failed:', qrUpdateError);
          } else {
            console.log(`✅ QR generated and saved for location ${locationId}:`, session.id);
            clearInterval(qrPolling); // Stop polling once QR is saved
          }
        }
      } catch (e) {
        console.error('❌ QR polling error:', e);
      }
    }, 1000); // Check every 1 second (fastest)

    // Set up connection status polling
    const statusPolling = setInterval(async () => {
      try {
        const status = waManager.getClientStatus(sessionName);
        console.log(`📊 Status check for ${sessionName}:`, status);
        
        if (status && status.status === 'connected') {
          clearInterval(qrPolling);
          clearInterval(statusPolling);
          clearTimeout(initTimeout);
          
          // Get phone number from client
          const client = waManager.getClientsMap()?.get(sessionName);
          const phoneNumber = client?.phoneNumber || 'Unknown';
          
          console.log(`📱 Connected phone number: ${phoneNumber}`);
          
          const { error: readyUpdateError } = await supabaseAdmin
            .from('sessions')
            .update({ 
              status: 'ready', 
              qr: null,
              phone_number: phoneNumber
            })
            .eq('id', session.id);
          
          if (readyUpdateError) {
            console.error('Ready update failed:', readyUpdateError);
          } else {
            console.log(`✅ WhatsApp connected and saved for location ${locationId}`);
            console.log(`✅ Phone number stored: ${phoneNumber}`);
            console.log(`✅ Client stored with sessionName: ${sessionName}`);
            console.log(`📋 Available clients after connection:`, waManager.getAllClients().map(client => client.sessionId));
          }
        }
      } catch (e) {
        console.error('Status polling error:', e);
      }
    }, 5000); // Check every 5 seconds

    // Cleanup polling on timeout
    setTimeout(() => {
      clearInterval(qrPolling);
      clearInterval(statusPolling);
    }, 300000); // 5 minutes timeout

    // Return session info
    res.json({ 
      success: true, 
      session: {
        id: session.id,
        status: 'initializing',
        qr: null
      }
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/ghl/location/:locationId/session', async (req, res) => {
  try {
    const { locationId } = req.params;

    // Find GHL account for this location first (try by location_id, then fallback)
    let ghlAccount = null;
    
    const { data: accountByLocation } = await supabaseAdmin
      .from('ghl_accounts')
      .select('id, user_id')
      .eq('location_id', locationId)
      .maybeSingle();
    
    if (accountByLocation) {
      ghlAccount = accountByLocation;
    } else {
      // Fallback: use any GHL account
      const { data: anyAccount } = await supabaseAdmin
        .from('ghl_accounts')
        .select('id, user_id')
        .limit(1)
        .maybeSingle();
      
      if (anyAccount) {
        ghlAccount = anyAccount;
      }
    }

    if (!ghlAccount) {
      return res.json({ status: 'none' });
    }

    // Get latest session for this GHL account
    const { data: existing } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existing || existing.length === 0) {
      return res.json({ status: 'none' });
    }

    const s = existing[0];
    res.json({ status: s.status, qr: s.qr, phone_number: s.phone_number });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to fetch session status' });
  }
});

// Logout session (disconnect WhatsApp)
app.post('/ghl/location/:locationId/session/logout', async (req, res) => {
  try {
    const { locationId } = req.params;
    
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found' });
    }

    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Disconnect WhatsApp client FIRST (this will logout from mobile)
    const cleanSubaccountId = ghlAccount.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionName = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    
    console.log(`🔌 Disconnecting WhatsApp session: ${sessionName}`);
    
    // Step 1: Update database status to disconnected first
    await supabaseAdmin
      .from('sessions')
      .update({ status: 'disconnected' })
      .eq('id', session.id);
    console.log(`📊 Database status updated to disconnected`);
    
    // Step 2: Disconnect from WhatsApp (this logs out from mobile)
    try {
      await waManager.disconnectClient(sessionName);
      console.log(`✅ WhatsApp disconnected from mobile`);
    } catch (disconnectError) {
      console.error(`⚠️ Error disconnecting WhatsApp: ${disconnectError.message}`);
      // Continue with cleanup even if disconnect fails
    }
    
    // Step 3: Clear session data (removes auth files)
    try {
      waManager.clearSessionData(sessionName);
      console.log(`🗑️ Session data cleared from disk`);
    } catch (clearError) {
      console.error(`⚠️ Error clearing session data: ${clearError.message}`);
    }
    
    // Step 4: Send email notification for dashboard logout
    try {
      const emailService = require('./lib/email');
      await emailService.sendDisconnectNotification(
        ghlAccount.user_id,
        locationId,
        'dashboard'
      );
      console.log(`📧 Disconnect email sent for dashboard logout`);
    } catch (emailError) {
      console.error(`⚠️ Failed to send disconnect email:`, emailError.message);
      // Don't fail the logout if email fails
    }

    // Step 5: Delete session from database completely (after disconnect)
    await supabaseAdmin
      .from('sessions')
      .delete()
      .eq('id', session.id);
    console.log(`🗑️ Session deleted from database`);

    console.log(`✅ Session logged out successfully for location: ${locationId}`);
    res.json({ status: 'success', message: 'Session logged out successfully and disconnected from WhatsApp' });
  } catch (error) {
    console.error('Logout session error:', error);
    res.status(500).json({ error: 'Failed to logout session' });
  }
});

// Reset Session (Delete session from database)
app.post('/ghl/location/:locationId/session/reset', async (req, res) => {
  try {
    const { locationId } = req.params;
    
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found' });
    }

    // Get all sessions for this subaccount
    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount.id);

    console.log(`🔄 Resetting ${sessions?.length || 0} session(s) for location: ${locationId}`);

    // Disconnect all WhatsApp clients and cleanup session data
    if (sessions && sessions.length > 0) {
      for (const session of sessions) {
        try {
          // Try both session name formats to ensure cleanup
          const cleanSubaccountId = ghlAccount.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const cleanSessionId = session.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          
          // Format 1: location_${subaccountId}_${sessionId}
          const sessionName1 = `location_${cleanSubaccountId}_${cleanSessionId}`;
          
          // Format 2: subaccount_${subaccountId}_${sessionId} (legacy)
          const sessionName2 = `subaccount_${ghlAccount.id}_${session.id}`;
          
          // Cleanup both formats
          try {
            await waManager.disconnectClient(sessionName1);
            waManager.clearSessionData(sessionName1);
            console.log(`✅ Cleaned up session (format 1): ${sessionName1}`);
          } catch (e) {
            console.log(`⚠️ Session format 1 not found: ${sessionName1}`);
          }
          
          try {
            await waManager.disconnectClient(sessionName2);
            waManager.clearSessionData(sessionName2);
            console.log(`✅ Cleaned up session (format 2): ${sessionName2}`);
          } catch (e) {
            console.log(`⚠️ Session format 2 not found: ${sessionName2}`);
          }
        } catch (sessionError) {
          console.error(`⚠️ Error cleaning session ${session.id}:`, sessionError.message);
        }
      }
    }

    // Delete all sessions from database
    const { error: sessionsDeleteError } = await supabaseAdmin
      .from('sessions')
      .delete()
      .eq('subaccount_id', ghlAccount.id);

    if (sessionsDeleteError) {
      console.error('❌ Error deleting sessions from database:', sessionsDeleteError);
      return res.status(500).json({ error: 'Failed to delete sessions from database' });
    }

    console.log(`✅ Reset session completed: ${sessions?.length || 0} session(s) deleted for location: ${locationId}`);
    res.json({ 
      status: 'success', 
      message: `Session reset successfully. ${sessions?.length || 0} session(s) deleted.`,
      deletedCount: sessions?.length || 0
    });
  } catch (error) {
    console.error('Reset session error:', error);
    res.status(500).json({ error: 'Failed to reset session', details: error.message });
  }
});

// Delete subaccount
app.delete('/admin/ghl/delete-subaccount', requireAuth, async (req, res) => {
  try {
    const { locationId } = req.body;
    
    if (!locationId) {
      return res.status(400).json({ error: 'Location ID is required' });
    }

    console.log(`🗑️ Deleting subaccount for location: ${locationId} by user: ${req.user?.id}`);

    // Get GHL account and verify ownership
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .eq('user_id', req.user?.id) // Verify user owns this account
      .maybeSingle();

    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found or you do not have permission to delete it' });
    }

    // Get all sessions for this subaccount
    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', ghlAccount.id);

    console.log(`📋 Found ${sessions?.length || 0} session(s) to cleanup`);

    // Disconnect all WhatsApp clients and cleanup session data
    if (sessions && sessions.length > 0) {
      for (const session of sessions) {
        try {
          // Try both session name formats to ensure cleanup
          const cleanSubaccountId = ghlAccount.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const cleanSessionId = session.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          
          // Format 1: location_${subaccountId}_${sessionId} (used in /ghl/location endpoints)
          const sessionName1 = `location_${cleanSubaccountId}_${cleanSessionId}`;
          
          // Format 2: subaccount_${subaccountId}_${sessionId} (legacy format)
          const sessionName2 = `subaccount_${ghlAccount.id}_${session.id}`;
          
          // Cleanup both formats to be safe
          try {
            await waManager.disconnectClient(sessionName1);
            waManager.clearSessionData(sessionName1);
            console.log(`✅ Cleaned up session (format 1): ${sessionName1}`);
          } catch (e) {
            console.log(`⚠️ Session format 1 not found: ${sessionName1}`);
          }
          
          try {
            await waManager.disconnectClient(sessionName2);
            waManager.clearSessionData(sessionName2);
            console.log(`✅ Cleaned up session (format 2): ${sessionName2}`);
          } catch (e) {
            console.log(`⚠️ Session format 2 not found: ${sessionName2}`);
          }
        } catch (sessionError) {
          console.error(`⚠️ Error cleaning session ${session.id}:`, sessionError.message);
          // Continue with other sessions
        }
      }
    }

    // Delete all sessions from database
    const { error: sessionsDeleteError } = await supabaseAdmin
      .from('sessions')
      .delete()
      .eq('subaccount_id', ghlAccount.id);

    if (sessionsDeleteError) {
      console.error('❌ Error deleting sessions from database:', sessionsDeleteError);
      // Don't fail the entire operation, but log the error
    } else {
      console.log(`✅ Deleted ${sessions?.length || 0} session(s) from database`);
    }

    // Delete GHL account
    const { error: accountDeleteError } = await supabaseAdmin
      .from('ghl_accounts')
      .delete()
      .eq('id', ghlAccount.id);

    if (accountDeleteError) {
      console.error('Error deleting GHL account:', accountDeleteError);
      return res.status(500).json({ error: 'Failed to delete account from database' });
    }

    // Mark location as inactive in used_locations (for anti-abuse tracking)
    const { error: updateUsedLocationError } = await supabaseAdmin
      .from('used_locations')
      .update({ 
        is_active: false,
        last_active_at: new Date().toISOString()
      })
      .eq('location_id', locationId)
      .eq('user_id', req.user?.id);

    if (updateUsedLocationError) {
      console.error('⚠️ Error updating used_locations (non-critical):', updateUsedLocationError);
      // Don't fail the operation, just log the error
    } else {
      console.log(`✅ Marked location as inactive in used_locations: ${locationId}`);
    }

    console.log(`✅ Subaccount deleted successfully for location: ${locationId}`);
    res.json({ status: 'success', message: 'Subaccount deleted successfully' });
  } catch (error) {
    console.error('Delete subaccount error:', error);
    res.status(500).json({ error: 'Failed to delete subaccount', details: error.message });
  }
});

// Sync all subaccounts (refresh tokens and reconnect WhatsApp)
app.post('/admin/ghl/sync-all-subaccounts', async (req, res) => {
  try {
    console.log('🔄 Starting sync for all subaccounts...');
    
    // Get all GHL accounts
    const { data: ghlAccounts } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .not('refresh_token', 'is', null);

    if (!ghlAccounts || ghlAccounts.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No subaccounts found to sync',
        syncedCount: 0 
      });
    }

    console.log(`📋 Found ${ghlAccounts.length} subaccounts to sync`);

    let syncedCount = 0;
    let errorCount = 0;
    const results = [];

    for (const ghlAccount of ghlAccounts) {
      try {
        console.log(`🔄 Syncing subaccount: ${ghlAccount.location_id}`);
        
        // 1. Refresh token
        let tokenRefreshed = false;
        try {
          await ensureValidToken(ghlAccount, true); // Force refresh
          tokenRefreshed = true;
          console.log(`✅ Token refreshed for: ${ghlAccount.location_id}`);
        } catch (tokenError) {
          console.error(`❌ Token refresh failed for ${ghlAccount.location_id}:`, tokenError);
        }

        // 2. Get existing sessions
        const { data: sessions } = await supabaseAdmin
      .from('sessions')
          .select('*')
          .eq('subaccount_id', ghlAccount.id)
          .order('created_at', { ascending: false });

        // 3. Reconnect WhatsApp sessions
        let sessionReconnected = false;
        if (sessions && sessions.length > 0) {
          const latestSession = sessions[0];
          const sessionName = `location_${ghlAccount.id}_${latestSession.id}`;
          
          try {
            // Check current client status
            const clientStatus = waManager.getClientStatus(sessionName);
            console.log(`🔍 Current client status for ${ghlAccount.location_id}: ${clientStatus?.status || 'not found'}`);
            
            // If client is not connected or in qr_ready state, reconnect
            if (!clientStatus || (clientStatus.status !== 'connected' && clientStatus.status !== 'connecting')) {
              // Disconnect existing client if any
              await waManager.disconnectClient(sessionName);
              waManager.clearSessionData(sessionName);
              
              // Create new client
              await waManager.createClient(sessionName);
              sessionReconnected = true;
              console.log(`✅ WhatsApp session reconnected for: ${ghlAccount.location_id}`);
    } else {
              console.log(`✅ WhatsApp session already active for: ${ghlAccount.location_id}`);
              sessionReconnected = true;
            }
          } catch (sessionError) {
            console.error(`❌ Session reconnect failed for ${ghlAccount.location_id}:`, sessionError);
          }
        }

        syncedCount++;
        results.push({
          locationId: ghlAccount.location_id,
          tokenRefreshed,
          sessionReconnected,
          status: 'success'
        });

      } catch (error) {
        errorCount++;
        console.error(`❌ Sync failed for ${ghlAccount.location_id}:`, error);
        results.push({
          locationId: ghlAccount.location_id,
          status: 'error',
          error: error.message
        });
      }
    }

    console.log(`✅ Sync completed: ${syncedCount} successful, ${errorCount} failed`);

    res.json({ 
      success: true, 
      message: `Sync completed: ${syncedCount} subaccounts processed`,
      syncedCount,
      errorCount,
      results
    });

  } catch (error) {
    console.error('Sync all subaccounts error:', error);
    res.status(500).json({ 
      error: 'Failed to sync subaccounts',
      details: error.message 
    });
  }
});

// GHL Conversations Provider endpoints
app.post('/ghl/provider/messages', async (req, res) => {
  try {
    const { locationId, contactId, message, type = 'text' } = req.body;

    if (!locationId || !contactId || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find subaccount and session
    const { data: subaccount } = await supabaseAdmin
      .from('subaccounts')
      .select('*')
      .eq('ghl_location_id', locationId)
      .maybeSingle();

    if (!subaccount) {
      return res.status(404).json({ error: 'Subaccount not found' });
    }

    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('subaccount_id', subaccount.id)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!session || session.length === 0) {
      return res.status(404).json({ error: 'No active WhatsApp session found' });
    }

    // Send message via WhatsApp using Baileys
    const sessionId = session[0].id;
    const clientStatus = waManager.getClientStatus(sessionId);
    if (!clientStatus || clientStatus.status !== 'connected') {
      return res.status(404).json({ error: 'WhatsApp client not found or not connected' });
    }

    // Store message in database
    const { data: messageRecord } = await supabaseAdmin
      .from('messages')
      .insert({
        session_id: sessionId,
        contact_id: contactId,
        message: message,
        direction: 'outbound',
        status: 'sent'
      })
      .select()
      .single();

    // Send via WhatsApp using Baileys
    await waManager.sendMessage(sessionId, contactId, message);

    res.json({
      success: true,
      messageId: messageRecord.id,
      status: 'sent'
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Debug endpoint to check WhatsApp clients (Baileys)
app.get('/debug/whatsapp-clients', async (req, res) => {
  try {
    const clients = waManager.getAllClients();
    const clientInfo = clients.map(client => ({
      sessionId: client.sessionId,
      status: client.status,
      lastUpdate: client.lastUpdate,
      hasQR: client.hasQR,
      isConnected: client.status === 'connected'
    }));
    
    // Get version info (now async)
    const versionInfo = await waManager.getWhatsAppVersion();
    
    res.json({
      totalClients: clients.length,
      clients: clientInfo,
      availableSessions: clients.map(client => client.sessionId),
      versionInfo: versionInfo
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: 'Failed to get client info' });
  }
});

// Debug endpoint to clear session data and force fresh connection
app.post('/debug/clear-session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`🗑️ Clearing session data for: ${sessionId}`);
    
    waManager.clearSessionData(sessionId);
    
    res.json({
      success: true,
      message: `Session data cleared for ${sessionId}`,
      sessionId
    });
  } catch (error) {
    console.error('Clear session error:', error);
    res.status(500).json({ error: 'Failed to clear session data' });
  }
});

// Debug endpoint to check session status
app.get('/debug/session-status/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    // Get GHL account
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found' });
    }

    // Get session
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('user_id', ghlAccount.user_id)
      .eq('subaccount_id', ghlAccount.id)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (!session || session.length === 0) {
      return res.json({ 
        session: null, 
        message: 'No session found' 
      });
    }
    
    const currentSession = session[0];
    const cleanSubaccountId = currentSession.subaccount_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionName = `location_${cleanSubaccountId}_${currentSession.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    
    // Get client status
    const clientStatus = waManager.getClientStatus(sessionName);
    
    res.json({
      session: currentSession,
      sessionName,
      clientStatus,
      allClients: waManager.getAllClients()
    });
    
  } catch (error) {
    console.error('Session status error:', error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Manual token refresh endpoint
app.post('/debug/refresh-token/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    // Get GHL account
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();
    
    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found' });
    }

    // Force token refresh
    const newToken = await refreshGHLToken(ghlAccount);
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      locationId,
      newToken: newToken.substring(0, 20) + '...' // Show first 20 chars only
    });
    
  } catch (error) {
    console.error('Manual token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Test token endpoint
app.get('/debug/test-token/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();

    if (!ghlAccount) {
      return res.status(404).json({ error: 'GHL account not found' });
    }

    // Test current token
    const testResponse = await fetch(`${BASE}/locations/${locationId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ghlAccount.access_token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json"
      }
    });

    res.json({
      success: testResponse.ok,
      status: testResponse.status,
      message: testResponse.ok ? 'Token is valid' : 'Token is invalid',
      locationId,
      tokenExpires: ghlAccount.token_expires_at
    });
    
  } catch (error) {
    console.error('Token test error:', error);
    res.status(500).json({ 
      error: 'Failed to test token',
      details: error.message 
    });
  }
});

// Test message sending endpoint
app.post('/debug/send-message', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'Phone number and message required' });
    }
    
    const clients = waManager.getAllClients();
    
    if (clients.length === 0) {
      return res.status(404).json({ error: 'No WhatsApp clients available' });
    }
    
    const client = clients[0];
    const sessionKey = client.sessionId;
    console.log(`Sending test message using client: ${sessionKey}`);
    
    await waManager.sendMessage(sessionKey, phoneNumber, message);
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      sessionKey,
      phoneNumber,
      message
    });
  } catch (error) {
    console.error('Test message error:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Test incoming message webhook
app.post('/debug/test-incoming', async (req, res) => {
  try {
    const { from, message, locationId } = req.body;
    
    if (!from || !message) {
      return res.status(400).json({ error: 'From and message required' });
    }
    
    // Simulate incoming WhatsApp message
    const webhookData = {
      from: from.includes('@') ? from : `${from}@s.whatsapp.net`,
      message,
      timestamp: Date.now(),
      whatsappMsgId: `test_${Date.now()}`
    };
    
    console.log('🧪 Testing webhook with data:', webhookData);
    
    // Call the webhook internally
    const webhookResponse = await fetch(`${process.env.BACKEND_URL || 'https://api.octendr.com'}/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookData)
    });
    
    const responseText = await webhookResponse.text();
    
    res.json({
      success: true,
      message: 'Test webhook called',
      webhookData,
      webhookStatus: webhookResponse.status,
      webhookResponse: responseText
    });
  } catch (error) {
    console.error('Test incoming webhook error:', error);
    res.status(500).json({ error: 'Failed to test webhook', details: error.message });
  }
});


// Emergency message sending endpoint - creates new client if needed
app.post('/emergency/send-message', async (req, res) => {
  try {
    const { phoneNumber, message, locationId } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'Phone number and message required' });
    }
    
    console.log(`🚨 Emergency message sending to: ${phoneNumber}`);
    
    // Direct message sending without client dependency
    console.log(`🚨 Direct emergency message sending to: ${phoneNumber}`);
    
    // Try to find any available client first
    const clients = waManager.getAllClients();
    let messageSent = false;
    
    if (clients.length > 0) {
      console.log(`Found ${clients.length} available clients`);
      
      for (const client of clients) {
        try {
          const sessionKey = client.sessionId;
          console.log(`Trying client: ${sessionKey}`);
          console.log(`Client status:`, client.status);
          
          if (client.status === 'connected') {
            console.log(`Client ready, sending message...`);
            await waManager.sendMessage(sessionKey, phoneNumber, message);
            console.log(`✅ Message sent successfully via client: ${sessionKey}`);
            messageSent = true;
            break;
          } else {
            console.log(`Client not ready, skipping: ${sessionKey}`);
          }
        } catch (clientError) {
          console.error(`Error with client ${client.sessionId}:`, clientError);
          continue;
        }
      }
    } else {
      console.log(`No clients available`);
    }
    
    if (!messageSent) {
      console.log(`❌ No working clients found, message not sent`);
      return res.status(500).json({ 
        error: 'No working WhatsApp clients available',
        phoneNumber,
        message,
        availableClients: clients.length
      });
    }
    
    res.json({
      success: true,
      message: 'Emergency message sent successfully',
      phoneNumber,
      message,
      availableClients: clients.length
    });
    
  } catch (error) {
    console.error('Emergency message error:', error);
    res.status(500).json({ error: 'Failed to send emergency message', details: error.message });
  }
});


// Test GHL outbound webhook
app.post('/debug/test-outbound', async (req, res) => {
  try {
    const { contactId, text } = req.body;
    
    if (!contactId || !text) {
      return res.status(400).json({ error: 'ContactId and text required' });
    }
    
    // Simulate GHL outbound message
    const webhookData = {
      contactId: contactId,
      text: text,
      locationId: process.env.GHL_LOCATION_ID
    };
    
    console.log('🧪 Test endpoint called - provider-outbound webhook has been removed');
    
    res.json({ 
      status: 'success', 
      message: 'Provider outbound webhook has been removed. This endpoint is no longer used.'
    });
  } catch (error) {
    console.error('Test outbound error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GHL Workflow Webhook Handler
app.post('/api/ghl-workflow', async (req, res) => {
  try {
    console.log('🔄 GHL Workflow webhook received:', JSON.stringify(req.body, null, 2));
    
    const { 
      event_type, 
      contact_id, 
      contact_name, 
      contact_phone, 
      last_message, 
      assigned_user, 
      location_id,
      conversation_id,
      workflow_id,
      team_members 
    } = req.body;
    
    // Handle different workflow events
    switch (event_type) {
      case 'customer_replied':
        console.log('🔔 Customer replied workflow triggered');
        
        // Get team members from workflow data or assigned user
        let notificationRecipients = [];
        
        if (team_members && Array.isArray(team_members)) {
          notificationRecipients = team_members;
        } else if (assigned_user) {
          notificationRecipients = [assigned_user];
        }
        
        if (notificationRecipients.length > 0) {
          console.log(`📱 Sending notifications to: ${notificationRecipients.join(', ')}`);
          
          // Find available WhatsApp client
          const availableClients = waManager.getAllClients().filter(client => 
            client.status === 'connected' || client.status === 'ready'
          );
          
          if (availableClients.length > 0) {
            const notificationClient = availableClients[0];
            const clientKey = notificationClient.sessionId;
            
            // Format notification message
            let notificationMessage = `🔔 *Customer Replied*\n\n`;
            if (contact_name) {
              notificationMessage += `👤 Customer: ${contact_name}\n`;
            }
            if (contact_phone) {
              notificationMessage += `📞 Phone: ${contact_phone}\n`;
            }
            if (last_message) {
              notificationMessage += `💬 Message: ${last_message}`;
            }
            
            // Send notifications
            const results = [];
            for (const recipient of notificationRecipients) {
              try {
                await waManager.sendMessage(
                  clientKey,
                  recipient,
                  notificationMessage,
                  'text'
                );
                console.log(`✅ Notification sent to: ${recipient}`);
                results.push({ phone: recipient, status: 'success' });
              } catch (error) {
                console.error(`❌ Failed to send notification to ${recipient}:`, error.message);
                results.push({ phone: recipient, status: 'failed', error: error.message });
              }
            }
            
            res.json({
              status: 'success',
              message: `Notifications sent to ${results.filter(r => r.status === 'success').length}/${notificationRecipients.length} recipients`,
              results
            });
          } else {
            res.status(503).json({ 
              status: 'error', 
              message: 'No WhatsApp clients available for notifications' 
            });
          }
        } else {
          res.json({
            status: 'success',
            message: 'No team members to notify'
          });
        }
        break;
        
      case 'new_lead':
        console.log('🆕 New lead workflow triggered');
        // Handle new lead logic here
        res.json({ status: 'success', message: 'New lead workflow processed' });
        break;
        
      case 'follow_up':
        console.log('📞 Follow up workflow triggered');
        // Handle follow up logic here
        res.json({ status: 'success', message: 'Follow up workflow processed' });
        break;
        
      default:
        console.log(`ℹ️ Unknown workflow event: ${event_type}`);
        res.json({ status: 'success', message: 'Workflow event logged' });
    }
    
  } catch (error) {
    console.error('❌ GHL Workflow webhook error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Workflow processing failed',
      error: error.message 
    });
  }
});

// GHL Marketplace Action Execute Webhook
// This endpoint receives data when "Send via Octendr" action is triggered in GHL workflows
app.post('/webhooks/ghl/action-execute', async (req, res) => {
  try {
    console.log('🎯 GHL Marketplace Action Execute received:', JSON.stringify(req.body, null, 2));
    
    const {
      locationId,
      contactId,
      contact,
      phone,
      message,
      customFields,
      workflowData,
      actionData
    } = req.body;
    
    // Extract phone number from various possible fields
    const phoneNumber = phone || contact?.phone || contact?.phoneNumber || contact?.customFields?.phone;
    
    if (!phoneNumber) {
      console.error('❌ No phone number found in action data');
      return res.status(400).json({ 
        status: 'error', 
        message: 'Phone number is required' 
      });
    }
    
    // Get GHL account by locationId
    const { data: ghlAccount } = await supabaseAdmin
      .from('ghl_accounts')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();
    
    if (!ghlAccount) {
      console.error(`❌ GHL account not found for locationId: ${locationId}`);
      return res.status(404).json({ 
        status: 'error', 
        message: 'GHL account not found for this location' 
      });
    }
    
    // Get active WhatsApp session for this account
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('ghl_account_id', ghlAccount.id)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (!session) {
      console.error(`❌ No active WhatsApp session found for locationId: ${locationId}`);
      return res.status(404).json({ 
        status: 'error', 
        message: 'No active WhatsApp session found' 
      });
    }
    
    // Build client key
    const cleanSubaccountId = session.subaccount_id?.replace(/[^a-zA-Z0-9_-]/g, '_') || ghlAccount.id;
    const clientKey = `location_${cleanSubaccountId}_${session.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    
    // Check client status
    const clientStatus = waManager.getClientStatus(clientKey);
    if (!clientStatus || (clientStatus.status !== 'connected' && clientStatus.status !== 'ready')) {
      console.error(`❌ WhatsApp client not connected for session: ${session.id}`);
      return res.status(503).json({ 
        status: 'error', 
        message: 'WhatsApp client not connected' 
      });
    }
    
    // Format phone number (E.164 format)
    let formattedPhone = phoneNumber;
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone.replace(/^\+/, '');
    }
    
    // Prepare message text
    const messageText = message || actionData?.message || 'Message from GHL workflow';
    
    // Send WhatsApp message
    try {
      await waManager.sendMessage(
        clientKey,
        formattedPhone,
        messageText,
        'text'
      );
      
      console.log(`✅ Message sent via GHL Marketplace Action: ${formattedPhone}`);
      
      // Log the action execution
      await supabaseAdmin.from('subscription_events').insert({
        user_id: ghlAccount.user_id,
        event_type: 'ghl_marketplace_action_executed',
        plan_name: 'marketplace_action',
        metadata: {
          location_id: locationId,
          contact_id: contactId,
          phone: formattedPhone,
          session_id: session.id,
          action_type: 'send_via_octendr'
        }
      });
      
      res.json({
        status: 'success',
        message: 'Message sent successfully',
        data: {
          phone: formattedPhone,
          message: messageText,
          locationId,
          contactId
        }
      });
    } catch (sendError) {
      console.error('❌ Error sending WhatsApp message:', sendError);
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to send WhatsApp message',
        error: sendError.message 
      });
    }
    
  } catch (error) {
    console.error('❌ GHL Marketplace Action Execute error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Action execution failed',
      error: error.message 
    });
  }
});

// Team notification webhook endpoint for GHL workflow
app.post('/api/team-notification', async (req, res) => {
  try {
    console.log('🔔 Team notification webhook received:', JSON.stringify(req.body, null, 2));
    
    // Support both old format (message, user) and new format (last_message, assigned_user, contact_phone, contact_name)
    const message = req.body.message || req.body.last_message;
    let user = req.body.user || req.body.assigned_user;
    const contactName = req.body.contact_name;
    const contactPhone = req.body.contact_phone;
    
    // Support multiple users (comma-separated)
    const users = user ? user.split(',').map(u => u.trim()).filter(u => u) : [];
    
    // Validate required fields
    if (!message) {
      console.log('❌ Missing required field: message or last_message');
      return res.status(400).json({ 
        status: 'error', 
        message: 'Missing required field: message or last_message',
        receivedFields: Object.keys(req.body)
      });
    }
    
    if (users.length === 0) {
      console.log('❌ Missing required field: user or assigned_user');
      return res.status(400).json({ 
        status: 'error', 
        message: 'Missing required field: user (phone number) or assigned_user',
        receivedFields: Object.keys(req.body)
      });
    }
    
    console.log(`📱 Sending notification to ${users.length} team member(s): ${users.join(', ')}`);
    console.log(`👤 Contact name: ${contactName || 'N/A'}`);
    console.log(`📞 Contact phone: ${contactPhone || 'N/A'}`);
    console.log(`💬 Message content: ${message}`);
    
    // Find an available WhatsApp client for sending notifications
    const availableClients = waManager.getAllClients().filter(client => 
      client.status === 'connected' || client.status === 'ready'
    );
    
    if (availableClients.length === 0) {
      console.log('❌ No available WhatsApp clients for team notifications');
      return res.status(503).json({ 
        status: 'error', 
        message: 'No WhatsApp clients available for notifications' 
      });
    }
    
    // Use the first available client for notifications
    const notificationClient = availableClients[0];
    const clientKey = notificationClient.sessionId;
    
    console.log(`📱 Using client: ${clientKey} for team notifications`);
    
    // Format notification message with contact details
    let notificationMessage = `🔔 *Customer Replied*\n\n`;
    
    if (contactName) {
      notificationMessage += `👤 Customer: ${contactName}\n`;
    }
    if (contactPhone) {
      notificationMessage += `📞 Phone: ${contactPhone}\n`;
    }
    
    notificationMessage += `💬 Message: ${message}`;
    
    // Send notification to all team members
    const results = [];
    for (const userPhone of users) {
      try {
        await waManager.sendMessage(
          clientKey,
          userPhone,
          notificationMessage,
          'text'
        );
        console.log(`✅ Team notification sent successfully to: ${userPhone}`);
        results.push({ phone: userPhone, status: 'success' });
      } catch (error) {
        console.error(`❌ Failed to send notification to ${userPhone}:`, error.message);
        results.push({ phone: userPhone, status: 'failed', error: error.message });
      }
    }
    
    res.json({
      status: 'success',
      message: `Team notifications sent to ${results.filter(r => r.status === 'success').length}/${users.length} recipients`,
      recipients: results,
      clientUsed: clientKey
    });
    
  } catch (error) {
    console.error('❌ Team notification error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Force token refresh with new scopes
app.post('/admin/force-reauthorize/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    console.log(`🔄 Force re-authorization for account: ${accountId}`);
    
    // Delete the account tokens to force re-auth
    const { error } = await supabaseAdmin
      .from('ghl_accounts')
      .delete()
      .eq('id', accountId);
    
    if (error) {
      throw error;
    }
    
    res.json({
      status: 'success',
      message: 'Account deleted. Please re-authorize with new scopes.',
      authUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`
    });
    
  } catch (error) {
    console.error('Force reauth error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test team notification webhook endpoint
app.post('/api/test-team-notification', async (req, res) => {
  try {
    console.log('🧪 Testing team notification webhook');
    
    const testData = {
      message: 'This is a test message from customer',
      user: '+923001234567' // Replace with actual team member number
    };
    
    // Call the team notification endpoint internally
    const notificationResponse = await fetch(`${process.env.BACKEND_URL || 'https://api.octendr.com'}/api/team-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });
    
    const result = await notificationResponse.json();
    
    res.json({
      status: 'success',
      message: 'Team notification test completed',
      testData,
      notificationResult: result
    });
    
  } catch (error) {
    console.error('Test team notification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a session
app.get('/messages/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50 } = req.query;
    
    console.log(`📨 Fetching messages for session: ${sessionId}, limit: ${limit}`);
    
    // Get messages from database
    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', req.user.id) // Ensure user can only access their own messages
      .order('created_at', { ascending: true })
      .limit(parseInt(limit));
    
    if (error) {
      console.error('❌ Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
    
    console.log(`✅ Found ${messages?.length || 0} messages for session: ${sessionId}`);
    
    res.json(messages || []);
  } catch (error) {
    console.error('❌ Error in messages endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================
// STRIPE SUBSCRIPTION ENDPOINTS
// ===========================================

// Create Stripe Checkout Session
// Endpoint: POST /api/stripe/create-checkout
// Required Header: X-User-ID (user authentication)
// Request body: { plan, userEmail, successUrl?, cancelUrl? }
// Response: { sessionId, url }
app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured. Please set STRIPE_SECRET_KEY in environment variables.' });
    }

    const { plan, userEmail, successUrl, cancelUrl, additional_subaccount } = req.body;
    const userId = req.user.id;
    const isAdditionalSubaccount = req.query.additional_subaccount === 'true' || additional_subaccount === true;

    // Handle additional subaccount purchase
    if (isAdditionalSubaccount) {
      // Get user's current subscription info
      const { data: userInfo } = await supabaseAdmin
        .from('users')
        .select('subscription_status, max_subaccounts')
        .eq('id', userId)
        .single();

      if (!userInfo || userInfo.subscription_status !== 'active' || userInfo.subscription_status === 'past_due') {
        return res.status(400).json({ error: 'You must have an active subscription (payment up to date) to purchase additional subaccounts' });
      }

      // Additional subaccounts are only available for Professional Plan users
      const { data: fullUserInfo } = await supabaseAdmin
        .from('users')
        .select('subscription_plan')
        .eq('id', userId)
        .single();

      if (!fullUserInfo || fullUserInfo.subscription_plan !== 'professional') {
        return res.status(400).json({ error: 'Additional subaccounts are only available for Professional Plan subscribers' });
      }

      // Create one-time payment for $4 additional subaccount (Professional Plan only)
      const additionalSubaccountPrice = 400; // $4 in cents

      const frontendUrl = process.env.FRONTEND_URL || 'https://whatsappghl.vercel.app';
      const businessName = process.env.STRIPE_BUSINESS_NAME || 'Octendr';
      
      const sessionConfig = {
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Additional Subaccount (Professional Plan)',
              description: 'Add one more subaccount to your existing plan'
            },
            unit_amount: additionalSubaccountPrice,
          },
          quantity: 1,
        }],
        mode: 'payment', // One-time payment
        success_url: `${frontendUrl}/dashboard?subscription=success&additional_subaccount=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/dashboard?subscription=cancelled`,
        customer_email: userEmail,
        metadata: {
          user_id: userId,
          additional_subaccount: 'true',
          current_max: userInfo.max_subaccounts.toString()
        },
      };

      const session = await stripe.checkout.sessions.create(sessionConfig);
      return res.json({ sessionId: session.id, url: session.url });
    }

    // Regular plan purchase
    if (!plan || (plan !== 'starter' && plan !== 'professional')) {
      return res.status(400).json({ error: 'Invalid plan. Must be "starter" or "professional"' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get price ID based on plan
    const priceId = plan === 'starter' 
      ? STRIPE_STARTER_PRICE_ID
      : STRIPE_PROFESSIONAL_PRICE_ID;

    if (!priceId) {
      return res.status(500).json({ error: `Price ID not configured for ${plan} plan. Please set STRIPE_${plan.toUpperCase()}_PRICE_ID in environment variables.` });
    }

    // Get user email if not provided
    let email = userEmail;
    if (!email) {
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();
      
      if (userError) {
        console.error('Error fetching user email:', userError);
      } else if (user) {
        email = user.email;
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://whatsappghl.vercel.app';
    
    // Get business name from environment (default to "Octendr" if not set)
    const businessName = process.env.STRIPE_BUSINESS_NAME || 'Octendr';

    // Create checkout session - Support both recurring (subscription) and one-time payments
    // Check if price is one-time or recurring
    let price;
    try {
      price = await stripe.prices.retrieve(priceId);
    } catch (priceError) {
      console.error('Error retrieving price from Stripe:', priceError);
      return res.status(500).json({ 
        error: 'Failed to retrieve price from Stripe',
        details: priceError.message 
      });
    }

    const isRecurring = price.recurring !== null; // If recurring is not null, it's a subscription
    const mode = isRecurring ? 'subscription' : 'payment';
    
    // Use custom URLs if provided, otherwise use defaults
    const finalSuccessUrl = successUrl || `${frontendUrl}/dashboard?subscription=success&session_id={CHECKOUT_SESSION_ID}`;
    const finalCancelUrl = cancelUrl || `${frontendUrl}/dashboard?subscription=cancelled`;
    
    // Create checkout session
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: mode, // 'subscription' for recurring OR 'payment' for one-time
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      customer_email: email,
      metadata: {
        user_id: userId,           // Required - Webhook ke liye
        plan_type: plan,           // Required - 'starter' or 'professional'
        payment_type: isRecurring ? 'recurring' : 'one-time', // Optional - Track payment type
        business_name: businessName, // Store business name in metadata
      },
    };

    // Add subscription_data for recurring payments to customize description
    if (mode === 'subscription') {
      sessionConfig.subscription_data = {
        description: `Subscription to ${businessName} ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
        metadata: {
          business_name: businessName,
        },
      };
    }

    // Add payment_intent_data for one-time payments
    if (mode === 'payment') {
      sessionConfig.payment_intent_data = {
        description: `Payment to ${businessName} for ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
        metadata: {
          business_name: businessName,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
});

// Create Stripe Customer Portal Session
// Endpoint: POST /api/stripe/customer-portal
// Required Header: X-User-ID (user authentication)
// Request body: { customer_id }
// Response: { url } - Stripe Customer Portal URL
app.post('/api/stripe/customer-portal', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const userId = req.user.id;

    // Get user's stripe_customer_id from database
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, stripe_customer_id, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('❌ User not found:', userError);
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripe_customer_id) {
      return res.status(400).json({ 
        error: 'No Stripe customer found',
        details: 'You need to subscribe to a plan first before managing billing.' 
      });
    }

    const customer_id = user.stripe_customer_id;

    const frontendUrl = process.env.FRONTEND_URL || 'https://whatsappghl.vercel.app';

    // Verify customer exists in Stripe
    try {
      const customer = await stripe.customers.retrieve(customer_id);
      if (customer.deleted) {
        return res.status(400).json({ 
          error: 'Customer has been deleted in Stripe',
          details: 'The Stripe customer associated with this account no longer exists.'
        });
      }
    } catch (stripeError) {
      console.error('❌ Error retrieving Stripe customer:', stripeError);
      if (stripeError.code === 'resource_missing') {
        return res.status(404).json({ 
          error: 'Stripe customer not found',
          details: 'The customer ID does not exist in Stripe. Please contact support.'
        });
      }
      throw stripeError; // Re-throw if it's a different error
    }

    // Create customer portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: `${frontendUrl}/dashboard/subscription`,
    });

    console.log(`✅ Customer portal session created for user ${userId}, customer ${customer_id}`);

    res.json({ 
      url: portalSession.url
    });
  } catch (error) {
    console.error('❌ Error creating customer portal session:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create customer portal session';
    let errorDetails = error.message;
    
    if (error.type === 'StripeInvalidRequestError') {
      if (error.code === 'resource_missing') {
        errorMessage = 'Stripe customer not found';
        errorDetails = 'The customer ID does not exist in Stripe. Please ensure you have completed a checkout process.';
      } else if (error.message.includes('billing portal')) {
        errorMessage = 'Stripe Billing Portal not configured';
        errorDetails = 'Please configure the Customer Portal in your Stripe Dashboard (Settings → Billing → Customer portal).';
      }
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails,
      code: error.code || 'unknown_error'
    });
  }
});

// Cancel Subscription Endpoint
// Endpoint: POST /api/stripe/cancel-subscription
// Required Header: X-User-ID (user authentication)
// Request body: { subscription_id }
app.post('/api/stripe/cancel-subscription', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const userId = req.user.id;
    const { subscription_id } = req.body;

    if (!subscription_id) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }

    // Verify subscription belongs to user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, stripe_subscription_id, subscription_status, subscription_plan')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.stripe_subscription_id !== subscription_id) {
      return res.status(403).json({ error: 'Subscription does not belong to this user' });
    }

    if (user.subscription_status !== 'active') {
      return res.status(400).json({ error: 'Only active subscriptions can be cancelled' });
    }

    // Cancel subscription in Stripe (at period end)
    const subscription = await stripe.subscriptions.update(subscription_id, {
      cancel_at_period_end: true
    });

    // Update database immediately - mark as cancelled but keep access until period end
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        subscription_status: 'cancelled',
        subscription_ends_at: new Date(subscription.current_period_end * 1000).toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Error updating subscription status:', updateError);
      return res.status(500).json({ error: 'Failed to update subscription status' });
    }

    // Log cancellation event
    await supabaseAdmin.from('subscription_events').insert({
      user_id: userId,
      event_type: 'subscription_cancelled',
      plan_name: user.subscription_plan || 'unknown',
      metadata: {
        stripe_subscription_id: subscription_id,
        cancel_at_period_end: true,
        period_end: subscription.current_period_end,
        cancelled_at: new Date().toISOString()
      }
    });

    console.log(`✅ Subscription ${subscription_id} cancelled for user ${userId}. Access until period end.`);

    res.json({ 
      success: true, 
      message: 'Subscription cancelled successfully',
      access_until: new Date(subscription.current_period_end * 1000).toISOString()
    });
  } catch (error) {
    console.error('❌ Error cancelling subscription:', error);
    res.status(500).json({ 
      error: 'Failed to cancel subscription',
      details: error.message
    });
  }
});

// Manual endpoint to trigger trial expiry check (for testing/admin)
app.post('/api/admin/check-expired-trials', async (req, res) => {
  try {
    await checkAndProcessExpiredTrials();
    res.json({ success: true, message: 'Trial expiry check completed' });
  } catch (error) {
    console.error('Error in manual trial expiry check:', error);
    res.status(500).json({ error: 'Failed to check expired trials', details: error.message });
  }
});

// Manual endpoint to trigger reminder check (for testing/admin)
app.post('/api/admin/check-reminders', async (req, res) => {
  try {
    await checkAndSendReminders();
    res.json({ success: true, message: 'Reminder check completed' });
  } catch (error) {
    console.error('Error in manual reminder check:', error);
    res.status(500).json({ error: 'Failed to check reminders', details: error.message });
  }
});

// Check and process expired subscriptions (both trials and cancelled subscriptions)
async function checkAndProcessExpiredSubscriptions() {
  try {
    console.log('🕐 Checking for expired subscriptions and trials...');
    const emailService = require('./lib/email');
    const now = new Date().toISOString();
    const nowDate = new Date();

    // 1. Find all users with expired trials (trial_ends_at <= now and status is still 'trial' or 'free')
    const { data: expiredTrials, error: trialError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, subscription_status, trial_ends_at')
      .in('subscription_status', ['trial', 'free'])
      .lte('trial_ends_at', now);

    // 2. Find all users with cancelled subscriptions that have passed subscription_ends_at
    const { data: expiredSubscriptions, error: subError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, subscription_status, subscription_ends_at, stripe_subscription_id')
      .eq('subscription_status', 'cancelled')
      .not('subscription_ends_at', 'is', null)
      .lte('subscription_ends_at', now);

    if (trialError) {
      console.error('❌ Error fetching expired trials:', trialError);
    }
    if (subError) {
      console.error('❌ Error fetching expired subscriptions:', subError);
    }

    const expiredUsers = [
      ...(expiredTrials || []),
      ...(expiredSubscriptions || [])
    ].filter((user, index, self) => 
      index === self.findIndex(u => u.id === user.id)
    ); // Remove duplicates

    if (expiredUsers.length === 0) {
      console.log('✅ No expired subscriptions/trials found');
      return;
    }

    console.log(`📋 Found ${expiredUsers.length} expired subscription(s)/trial(s)`);

    if (fetchError) {
      console.error('❌ Error fetching expired trials:', fetchError);
      return;
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      console.log('✅ No expired trials found');
      return;
    }

    console.log(`📋 Found ${expiredUsers.length} expired trial(s)`);

    for (const user of expiredUsers) {
      try {
        const isTrialExpired = (user.subscription_status === 'trial' || user.subscription_status === 'free') && 
                                user.trial_ends_at && 
                                new Date(user.trial_ends_at) <= nowDate;
        const isSubscriptionExpired = user.subscription_status === 'cancelled' && 
                                      user.subscription_ends_at && 
                                      new Date(user.subscription_ends_at) <= nowDate;

        console.log(`🔄 Processing expired ${isTrialExpired ? 'trial' : 'subscription'} for user: ${user.id} (${user.email})`);

        // Get all GHL accounts (subaccounts) for this user
        const { data: ghlAccounts, error: accountsError } = await supabaseAdmin
          .from('ghl_accounts')
          .select('id, location_id')
          .eq('user_id', user.id);

        if (accountsError) {
          console.error(`❌ Error fetching GHL accounts for user ${user.id}:`, accountsError);
          continue;
        }

        // Disconnect WhatsApp sessions (don't delete accounts - user requirement)
        if (ghlAccounts && ghlAccounts.length > 0) {
          for (const account of ghlAccounts) {
            // Disconnect all sessions for this account
            const { data: sessions } = await supabaseAdmin
              .from('sessions')
              .select('id, status')
              .eq('subaccount_id', account.id);

            if (sessions && sessions.length > 0) {
              for (const session of sessions) {
                try {
                  // Disconnect WhatsApp client
                  const sessionName = `subaccount_${account.id}_${session.id}`;
                  await waManager.disconnectClient(sessionName);
                  waManager.clearSessionData(sessionName);
                  
                  // Update session status to disconnected
                  await supabaseAdmin
                    .from('sessions')
                    .update({ status: 'disconnected' })
                    .eq('id', session.id);
                  
                  console.log(`✅ Disconnected session ${session.id} for account ${account.id}`);
                } catch (sessionError) {
                  console.error(`❌ Error disconnecting session ${session.id}:`, sessionError);
                }
              }
            }
          }
        }

        // Update user subscription status to 'expired'
        const updateData = {
          subscription_status: 'expired',
          max_subaccounts: 1 // Reset to trial limits
        };

        // If subscription was cancelled and expired, clear stripe_subscription_id
        if (isSubscriptionExpired && user.stripe_subscription_id) {
          updateData.stripe_subscription_id = null;
        }

        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update(updateData)
          .eq('id', user.id);

        if (updateError) {
          console.error(`❌ Error updating user status for ${user.id}:`, updateError);
          continue;
        }

        console.log(`✅ Updated user ${user.id} status to 'expired'`);

        // Log the expiry event
        await supabaseAdmin.from('subscription_events').insert({
          user_id: user.id,
          event_type: isTrialExpired ? 'trial_expired' : 'subscription_expired',
          plan_name: user.subscription_status,
          metadata: {
            disconnected_accounts: ghlAccounts?.length || 0,
            expired_at: now,
            expiry_type: isTrialExpired ? 'trial' : 'subscription'
          }
        });

        // Send expiry email (only for trial expiry, not cancelled subscriptions)
        if (isTrialExpired) {
          const emailResult = await emailService.sendTrialExpiredNotification(user.id);
          if (emailResult.success) {
            console.log(`✅ Sent expiry email to ${user.email}`);
          } else {
            console.error(`❌ Failed to send expiry email to ${user.email}:`, emailResult.error);
          }
        }

      } catch (userError) {
        console.error(`❌ Error processing user ${user.id}:`, userError);
        continue;
      }
    }

    console.log(`✅ Completed processing ${expiredUsers.length} expired subscription(s)/trial(s)`);
  } catch (error) {
    console.error('❌ Error in checkAndProcessExpiredSubscriptions:', error);
  }
}

// Keep old function name for backward compatibility
async function checkAndProcessExpiredTrials() {
  return checkAndProcessExpiredSubscriptions();
}

// Check for users needing reminder emails (3 days left, 1 day left)
async function checkAndSendReminders() {
  try {
    console.log('📧 Checking for trial reminders...');
    const emailService = require('./lib/email');
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // Find users with 3 days left (trial ends in 3 days)
    const { data: threeDayUsers, error: threeDayError } = await supabaseAdmin
      .from('users')
      .select('id, email, trial_ends_at')
      .eq('subscription_status', 'trial')
      .gte('trial_ends_at', new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000).toISOString())
      .lte('trial_ends_at', threeDaysFromNow.toISOString());

    // Find users with 1 day left (trial ends in 1 day)
    const { data: oneDayUsers, error: oneDayError } = await supabaseAdmin
      .from('users')
      .select('id, email, trial_ends_at')
      .eq('subscription_status', 'trial')
      .gte('trial_ends_at', new Date(now.getTime() + 0.5 * 24 * 60 * 60 * 1000).toISOString())
      .lte('trial_ends_at', oneDayFromNow.toISOString());

    // Check if reminders were already sent today
    const today = new Date().toISOString().split('T')[0];
    const { data: todayEvents } = await supabaseAdmin
      .from('subscription_events')
      .select('user_id, event_type, metadata')
      .eq('event_type', 'reminder_sent')
      .gte('created_at', new Date(today).toISOString());

    const reminderSentToday = new Set(
      todayEvents?.map(e => {
        const metadata = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
        return `${e.user_id}_${metadata?.days_left || ''}`;
      }) || []
    );

    // Send 3-day reminders
    if (threeDayUsers && threeDayUsers.length > 0) {
      for (const user of threeDayUsers) {
        const reminderKey = `${user.id}_3`;
        if (!reminderSentToday.has(reminderKey)) {
          const emailResult = await emailService.sendTrialReminder(user.id, 3);
          if (emailResult.success) {
            await supabaseAdmin.from('subscription_events').insert({
              user_id: user.id,
              event_type: 'reminder_sent',
              plan_name: 'trial',
              metadata: { days_left: 3 }
            });
            console.log(`✅ Sent 3-day reminder to ${user.email}`);
          }
        }
      }
    }

    // Send 1-day reminders
    if (oneDayUsers && oneDayUsers.length > 0) {
      for (const user of oneDayUsers) {
        const reminderKey = `${user.id}_1`;
        if (!reminderSentToday.has(reminderKey)) {
          const emailResult = await emailService.sendTrialReminder(user.id, 1);
          if (emailResult.success) {
            await supabaseAdmin.from('subscription_events').insert({
              user_id: user.id,
              event_type: 'reminder_sent',
              plan_name: 'trial',
              metadata: { days_left: 1 }
            });
            console.log(`✅ Sent 1-day reminder to ${user.email}`);
          }
        }
      }
    }

    console.log('✅ Completed reminder check');
  } catch (error) {
    console.error('❌ Error in checkAndSendReminders:', error);
  }
}

// Schedule trial expiry checks (every hour)
setInterval(async () => {
  await checkAndProcessExpiredTrials();
}, 60 * 60 * 1000); // 1 hour

// Schedule reminder checks (every 6 hours)
setInterval(async () => {
  await checkAndSendReminders();
}, 6 * 60 * 60 * 1000); // 6 hours

// Start Drip Queue Processor
dripQueueProcessor.start();
console.log('✅ Drip Queue Processor started');

// Get Stripe invoices for a user
app.get('/api/stripe/invoices', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's Stripe customer ID
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripe_customer_id || !stripe) {
      return res.json({ invoices: [] });
    }

    // Fetch invoices from Stripe
    const invoices = await stripe.invoices.list({
      customer: user.stripe_customer_id,
      limit: 100, // Get last 100 invoices
      expand: ['data.subscription', 'data.payment_intent']
    });

    // Format invoices for frontend
    const formattedInvoices = invoices.data.map(invoice => ({
      id: invoice.id,
      number: invoice.number,
      amount: invoice.amount_paid || invoice.amount_due,
      currency: invoice.currency.toUpperCase(),
      status: invoice.status,
      created: new Date(invoice.created * 1000).toISOString(),
      due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      paid_at: invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
      invoice_pdf: invoice.invoice_pdf,
      hosted_invoice_url: invoice.hosted_invoice_url,
      description: invoice.description || invoice.lines.data[0]?.description || 'Subscription payment',
      plan: invoice.lines.data[0]?.plan?.nickname || invoice.lines.data[0]?.plan?.product || 'Subscription'
    }));

    res.json({ invoices: formattedInvoices });
  } catch (error) {
    console.error('Error fetching Stripe invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Manual subscription sync endpoint (for frontend to trigger)
app.post('/api/subscription/sync', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's Stripe subscription ID
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, stripe_subscription_id, subscription_status, subscription_plan')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripe_subscription_id || !stripe) {
      return res.json({ 
        synced: false, 
        message: 'No Stripe subscription found or Stripe not configured' 
      });
    }

    // Sync this user's subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
    let stripeStatus = stripeSubscription.status;
    const cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end || false;

    // Check if there are any open invoices (pending payment)
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();
    
    if (userData?.stripe_customer_id) {
      try {
        const openInvoices = await stripe.invoices.list({
          customer: userData.stripe_customer_id,
          status: 'open',
          limit: 1
        });
        
        // If there's an open invoice, it means payment is pending, not cancelled
        if (openInvoices.data.length > 0 && stripeStatus === 'canceled' && !cancelAtPeriodEnd) {
          console.log(`📄 Found open invoice - marking as past_due instead of cancelled`);
          stripeStatus = 'past_due'; // Override to past_due if invoice is pending
        }
      } catch (invoiceError) {
        console.error('❌ Error checking open invoices:', invoiceError);
      }
    }

    // Determine plan from Stripe subscription items
    let planType = user.subscription_plan; // Default to existing plan
    let maxSubaccounts = 1; // Default to trial
    
    if (stripeSubscription.items && stripeSubscription.items.data && stripeSubscription.items.data.length > 0) {
      const priceAmount = stripeSubscription.items.data[0].price.unit_amount;
      
      // Determine plan based on price
      if (priceAmount === 1900) { // $19.00 = Starter
        planType = 'starter';
        maxSubaccounts = 2;
      } else if (priceAmount === 4900) { // $49.00 = Professional
        planType = 'professional';
        maxSubaccounts = 10;
      }
      
      // Also check metadata if available
      if (stripeSubscription.items.data[0].price.metadata?.plan_type) {
        planType = stripeSubscription.items.data[0].price.metadata.plan_type;
        maxSubaccounts = planType === 'starter' ? 2 : planType === 'professional' ? 10 : 1;
      }
    }

    let newStatus = user.subscription_status;
    let statusUpdate = {};

    if (stripeStatus === 'active' && cancelAtPeriodEnd === false) {
      newStatus = 'active';
      // Restore max_subaccounts based on plan when active
      statusUpdate.max_subaccounts = maxSubaccounts;
      // Update plan if it changed
      if (planType && planType !== user.subscription_plan) {
        statusUpdate.subscription_plan = planType;
      }
    } else if (stripeStatus === 'past_due' || stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired') {
      newStatus = 'past_due';
      // Keep max_subaccounts (user still has plan, just payment pending)
    } else if (stripeStatus === 'canceled' && cancelAtPeriodEnd === true) {
      // Check if cancelled subscription period has ended
      if (stripeSubscription.current_period_end) {
        const periodEnd = new Date(stripeSubscription.current_period_end * 1000);
        const now = new Date();
        
        // If period has ended, mark as expired
        if (periodEnd <= now) {
          newStatus = 'expired';
          statusUpdate.max_subaccounts = 1;
          statusUpdate.stripe_subscription_id = null; // Clear subscription ID
          console.log(`⏰ Subscription period ended for user ${userId} - marking as expired`);
        } else {
          // Still within period, mark as cancelled but keep plan limits
          newStatus = 'cancelled';
          // Keep max_subaccounts (user still has access until period end)
        }
      } else {
        // No period_end, mark as cancelled
        newStatus = 'cancelled';
        statusUpdate.max_subaccounts = 1;
      }
    } else if (stripeStatus === 'canceled' && !cancelAtPeriodEnd) {
      // Subscription was cancelled by Stripe but there might be a pending invoice
      newStatus = 'past_due'; // Payment pending, not actually cancelled
    } else if (stripeStatus === 'unpaid') {
      // Unpaid means payment failed but subscription still exists - mark as past_due
      newStatus = 'past_due';
    } else if (stripeStatus === 'active' && cancelAtPeriodEnd === true) {
      newStatus = 'cancelled'; // Cancelled but still has access
      // Keep max_subaccounts (user still has access until period end)
    }

    if (newStatus !== user.subscription_status) {
      statusUpdate.subscription_status = newStatus;
    }
      
    if (stripeSubscription.current_period_end) {
      statusUpdate.subscription_ends_at = new Date(stripeSubscription.current_period_end * 1000).toISOString();
    }

    // Update if status changed OR if max_subaccounts needs to be corrected
    const needsUpdate = Object.keys(statusUpdate).length > 0 || 
                       (newStatus === 'active' && user.max_subaccounts !== maxSubaccounts) ||
                       (planType && planType !== user.subscription_plan);

    if (needsUpdate) {
      await supabaseAdmin
        .from('users')
        .update(statusUpdate)
        .eq('id', user.id);

      // Log the sync event
      await supabaseAdmin.from('subscription_events').insert({
        user_id: user.id,
        event_type: 'subscription_synced_manual',
        plan_name: user.subscription_plan || 'unknown',
        metadata: {
          stripe_subscription_id: user.stripe_subscription_id,
          old_status: user.subscription_status,
          new_status: newStatus,
          stripe_status: stripeStatus
        }
      });
    }

    return res.json({ 
      synced: true, 
      status: newStatus,
      stripe_status: stripeStatus,
      message: newStatus !== user.subscription_status ? 'Subscription status updated' : 'Subscription status is up to date'
    });
  } catch (error) {
    console.error('❌ Error in manual subscription sync:', error);
    return res.status(500).json({ error: 'Failed to sync subscription status' });
  }
});

// Periodic Subscription Status Sync with Stripe (Real-time sync)
async function syncSubscriptionStatuses() {
  if (!stripe) {
    console.log('⚠️ Stripe not configured - skipping subscription sync');
    return;
  }

  try {
    console.log('🔄 Syncing subscription statuses with Stripe...');
    
    // Get all users with Stripe subscriptions
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, stripe_subscription_id, subscription_status, subscription_plan')
      .not('stripe_subscription_id', 'is', null);

    if (error) {
      console.error('❌ Error fetching users for subscription sync:', error);
      return;
    }

    if (!users || users.length === 0) {
      console.log('📋 No users with Stripe subscriptions found');
      return;
    }

    console.log(`📋 Found ${users.length} users with Stripe subscriptions to sync`);

    let updatedCount = 0;
    for (const user of users) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        let stripeStatus = stripeSubscription.status;
        const cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end || false;

        // Check if there are any open invoices (pending payment)
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('stripe_customer_id')
          .eq('id', user.id)
          .single();
        
        if (userData?.stripe_customer_id) {
          try {
            const openInvoices = await stripe.invoices.list({
              customer: userData.stripe_customer_id,
              status: 'open',
              limit: 1
            });
            
            // If there's an open invoice, it means payment is pending, not cancelled
            if (openInvoices.data.length > 0 && stripeStatus === 'canceled' && !cancelAtPeriodEnd) {
              stripeStatus = 'past_due'; // Override to past_due if invoice is pending
            }
          } catch (invoiceError) {
            // Silently continue if invoice check fails
          }
        }

        // Determine plan from Stripe subscription items
        let planType = user.subscription_plan; // Default to existing plan
        let maxSubaccounts = 1; // Default to trial
        
        if (stripeSubscription.items && stripeSubscription.items.data && stripeSubscription.items.data.length > 0) {
          const priceAmount = stripeSubscription.items.data[0].price.unit_amount;
          
          // Determine plan based on price (adjust these amounts based on your actual Stripe prices)
          if (priceAmount === 1900) { // $19.00 = Starter
            planType = 'starter';
            maxSubaccounts = 2;
          } else if (priceAmount === 4900) { // $49.00 = Professional
            planType = 'professional';
            maxSubaccounts = 10;
          }
          
          // Also check metadata if available
          if (stripeSubscription.items.data[0].price.metadata?.plan_type) {
            planType = stripeSubscription.items.data[0].price.metadata.plan_type;
            maxSubaccounts = planType === 'starter' ? 2 : planType === 'professional' ? 10 : 1;
          }
        }

        // Map Stripe status to our status
        let newStatus = user.subscription_status;
        let statusUpdate = {};

        if (stripeStatus === 'active' && cancelAtPeriodEnd === false) {
          newStatus = 'active';
          // Restore max_subaccounts based on plan when active
          statusUpdate.max_subaccounts = maxSubaccounts;
          // Update plan if it changed
          if (planType && planType !== user.subscription_plan) {
            statusUpdate.subscription_plan = planType;
          }
        } else if (stripeStatus === 'past_due' || stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired') {
          newStatus = 'past_due';
          // Keep max_subaccounts (user still has plan, just payment pending)
        } else if (stripeStatus === 'canceled' && cancelAtPeriodEnd === true) {
          // Check if cancelled subscription period has ended
          if (stripeSubscription.current_period_end) {
            const periodEnd = new Date(stripeSubscription.current_period_end * 1000);
            const now = new Date();
            
            // If period has ended, mark as expired
            if (periodEnd <= now) {
              newStatus = 'expired';
              statusUpdate.max_subaccounts = 1;
              statusUpdate.stripe_subscription_id = null; // Clear subscription ID
              console.log(`⏰ Subscription period ended for user ${user.id} - marking as expired`);
            } else {
              // Still within period, mark as cancelled but keep plan limits
              newStatus = 'cancelled';
              // Keep max_subaccounts (user still has access until period end)
            }
          } else {
            // No period_end, mark as cancelled
            newStatus = 'cancelled';
            statusUpdate.max_subaccounts = 1; // Reset to trial limits
          }
        } else if (stripeStatus === 'canceled' && !cancelAtPeriodEnd) {
          // Subscription was cancelled by Stripe but there might be a pending invoice
          newStatus = 'past_due'; // Payment pending, not actually cancelled
        } else if (stripeStatus === 'unpaid') {
          // Unpaid means payment failed but subscription still exists - mark as past_due
          newStatus = 'past_due';
        } else if (stripeStatus === 'active' && cancelAtPeriodEnd === true) {
          newStatus = 'cancelled'; // Cancelled but still has access
          // Keep max_subaccounts (user still has access until period end)
        }

        // Check if cancelled subscription has passed subscription_ends_at
        // This check is now done above in the status mapping logic

        // Update subscription end date
        if (stripeSubscription.current_period_end) {
          statusUpdate.subscription_ends_at = new Date(stripeSubscription.current_period_end * 1000).toISOString();
        }

        // Update if status changed OR if max_subaccounts needs to be corrected
        const needsUpdate = newStatus !== user.subscription_status || 
                           (newStatus === 'active' && user.max_subaccounts !== maxSubaccounts) ||
                           (planType && planType !== user.subscription_plan);

        if (needsUpdate) {
          if (newStatus !== user.subscription_status) {
            statusUpdate.subscription_status = newStatus;
          }

          await supabaseAdmin
            .from('users')
            .update(statusUpdate)
            .eq('id', user.id);

          console.log(`✅ Updated user ${user.id}: ${user.subscription_status} → ${newStatus}`);
          updatedCount++;

          // Log the sync event
          await supabaseAdmin.from('subscription_events').insert({
            user_id: user.id,
            event_type: newStatus === 'expired' ? 'subscription_expired' : 'subscription_synced',
            plan_name: user.subscription_plan || 'unknown',
            metadata: {
              stripe_subscription_id: user.stripe_subscription_id,
              old_status: user.subscription_status,
              new_status: newStatus,
              stripe_status: stripeStatus
            }
          });
        }
      } catch (stripeError) {
        console.error(`❌ Error syncing subscription for user ${user.id}:`, stripeError.message);
        // If subscription not found in Stripe, mark as cancelled
        if (stripeError.code === 'resource_missing') {
          await supabaseAdmin
            .from('users')
            .update({
              subscription_status: 'cancelled',
              max_subaccounts: 1
            })
            .eq('id', user.id);
          console.log(`⚠️ Stripe subscription not found for user ${user.id} - marked as cancelled`);
        }
      }
    }

    console.log(`✅ Subscription sync completed. Updated ${updatedCount} users.`);
  } catch (error) {
    console.error('❌ Error in subscription sync:', error);
  }
}

// Run subscription sync every 30 minutes for real-time updates
setInterval(syncSubscriptionStatuses, 30 * 60 * 1000); // Every 30 minutes
console.log('✅ Subscription sync scheduled (every 30 minutes)');

// Run sync immediately on startup (after 10 seconds)
setTimeout(syncSubscriptionStatuses, 10000);

// Run immediately on startup
setTimeout(async () => {
  await checkAndProcessExpiredTrials();
  await checkAndSendReminders();
}, 5000); // Wait 5 seconds after server starts

// Initialize global caches to prevent memory leaks
if (!global.messageCache) {
  global.messageCache = new Map();
}
if (!global.recentMessages) {
  global.recentMessages = new Set();
}
if (!global.recentInboundMessages) {
  global.recentInboundMessages = new Set();
}

// Cleanup global caches periodically to prevent memory leaks
setInterval(() => {
  try {
    // Clean old message cache entries (older than 10 minutes)
    if (global.messageCache) {
      const now = Date.now();
      for (const [key, value] of global.messageCache.entries()) {
        if (now - value.timestamp > 10 * 60 * 1000) {
          global.messageCache.delete(key);
        }
      }
    }
    
    // Clean recent messages set if it gets too large (prevent memory leak)
    if (global.recentMessages && global.recentMessages.size > 10000) {
      global.recentMessages.clear();
    }
    
    // Clean recent inbound messages set if it gets too large
    if (global.recentInboundMessages && global.recentInboundMessages.size > 10000) {
      global.recentInboundMessages.clear();
    }
  } catch (cleanupError) {
    console.error('❌ Error cleaning global caches:', cleanupError);
  }
}, 30 * 60 * 1000); // Every 30 minutes

// Global error handlers to prevent server crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - just log the error
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit - just log the error
  // In production, you might want to gracefully shutdown
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`GHL OAuth URL: https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${GHL_CLIENT_ID}&redirect_uri=${encodeURIComponent(GHL_REDIRECT_URI)}&scope=${encodeURIComponent(GHL_SCOPES)}`);
  
  // Validate environment variables (non-blocking)
  validateEnvironment();
});