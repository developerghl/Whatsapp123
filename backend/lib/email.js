const { createClient } = require('@supabase/supabase-js');

// Email service for sending notifications
class EmailService {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.supabaseAdmin = createClient(this.supabaseUrl, this.supabaseKey);
  }

  /**
   * Send daily connection lost email notification
   * @param {string} userId - User ID
   * @param {string} locationId - GHL Location ID
   */
  async sendDailyDisconnectReminder(userId, locationId) {
    try {
      console.log(`📧 Preparing daily disconnect reminder for user: ${userId}, location: ${locationId}`);

      // Get user email from database
      const { data: user, error: userError } = await this.supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user || !user.email) {
        console.error('❌ Failed to fetch user email:', userError || 'No email');
        return { success: false, error: 'User email not found' };
      }

      const userName = user.name || user.email.split('@')[0];
      const subject = 'Action Required: WhatsApp is Disconnected';
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
              .header { background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%); padding: 30px; text-align: center; color: white; }
              .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
              .content { padding: 40px 30px; }
              .h2 { color: #1f2937; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 20px; }
              .p { color: #4b5563; font-size: 16px; margin-bottom: 20px; }
              .warning-box { background-color: #FFF3E0; border-left: 4px solid #FF9800; padding: 15px; margin: 25px 0; border-radius: 4px; }
              .warning-text { color: #E65100; font-size: 15px; margin: 0; font-weight: 500; }
              .button-container { text-align: center; margin: 35px 0; }
              .button { background-color: #1a73e8; color: #ffffff; display: inline-block; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; transition: background-color 0.3s; }
              .footer { background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
              .footer-text { color: #6b7280; font-size: 14px; margin: 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>WhatsApp Connection Lost</h1>
              </div>
              <div class="content">
                <h2 class="h2">Hello ${userName},</h2>
                <p class="p">This is a daily reminder that your WhatsApp connection for Location ID <strong>${locationId}</strong> is currently <strong>disconnected</strong>.</p>
                <div class="warning-box">
                  <p class="warning-text">⚠️ Your scheduled drip messages and automatic replies for this location are paused and will not send until you reconnect.</p>
                </div>
                <p class="p">Please log into your dashboard and scan the QR code from your WhatsApp mobile app to restore the connection.</p>
                <div class="button-container">
                  <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.octendr.com'}" class="button">Log In to Reconnect</a>
                </div>
              </div>
              <div class="footer">
                <p class="footer-text">This is an automated daily reminder from Octendr.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.octendr.com';
      const textContent = [
        `Hello ${userName},`,
        '',
        `This is a daily reminder that your WhatsApp connection for Location ID ${locationId} is currently disconnected.`,
        '',
        'Your scheduled drip messages and automatic replies for this location are paused until you reconnect.',
        '',
        'Please log into your dashboard and scan the QR code from your WhatsApp mobile app.',
        '',
        `Log in: ${appUrl}`,
        '',
        'This is an automated daily reminder from Octendr.',
      ].join('\n');

      return await this.sendEmailViaAPI({
        to: user.email,
        subject,
        html: htmlContent,
        text: textContent,
      });
    } catch (error) {
      console.error('❌ Error in sendDailyDisconnectReminder:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send connection lost email notification to user
   * Emails are sent for 3 scenarios:
   * 1. Mobile logout (user logs out from phone)
   * 2. Dashboard logout (user manually disconnects from dashboard)
   * 3. System disconnect (when dashboard shows "disconnected" status)
   * @param {string} userId - User ID
   * @param {string} locationId - GHL Location ID
   * @param {string} reason - Reason for disconnect (mobile/dashboard/system_dashboard)
   */
  async sendDisconnectNotification(userId, locationId, reason = 'mobile', details = null) {
    try {
      console.log(`📧 Preparing disconnect email for user: ${userId}, location: ${locationId}, reason: ${reason}`);

      // Get user email from database
      const { data: user, error: userError } = await this.supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        console.error('❌ Failed to fetch user for email:', userError);
        return { success: false, error: 'User not found' };
      }

      if (!user.email) {
        console.error('❌ User email not found');
        return { success: false, error: 'User email not available' };
      }

      // Get GHL account details
      const { data: ghlAccount } = await this.supabaseAdmin
        .from('ghl_accounts')
        .select('location_id')
        .eq('location_id', locationId)
        .eq('user_id', userId)
        .maybeSingle();

      const locationName = ghlAccount ? `Location ${locationId}` : `Location ${locationId}`;

      // Prepare email content based on disconnect reason
      // 3 scenarios supported:
      // 1. 'mobile' - User logs out from phone
      // 2. 'dashboard' - User manually disconnects from dashboard
      // 3. 'system_dashboard' - System causes disconnect visible on dashboard
      let subject, disconnectReason, emailType;
      
      if (reason === 'system_dashboard') {
        subject = 'WhatsApp Connection Lost - Action May Be Required';
        disconnectReason = 'lost due to a system issue';
        emailType = 'system_dashboard';
      } else if (reason === 'mobile') {
        subject = 'WhatsApp Connection - Action Required';
        disconnectReason = 'disconnected from your mobile phone';
        emailType = 'mobile';
      } else {
        // Default to dashboard logout
        subject = 'WhatsApp Connection - Action Required';
        disconnectReason = 'logged out from the dashboard';
        emailType = 'dashboard';
      }
      
      const userName = user.name || user.email.split('@')[0];
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Connection Lost</title>
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
              .alert-box {
                background: #FFF3E0;
                border-left: 4px solid #FF9800;
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .alert-box strong {
                color: #E65100;
                display: block;
                margin-bottom: 10px;
                font-size: 18px;
              }
              .info-box {
                background: #F0F2F5;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
              }
              .info-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #E9EDEF;
              }
              .info-row:last-child {
                border-bottom: none;
              }
              .button {
                display: inline-block;
                background: #25D366;
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 20px 0;
                text-align: center;
              }
              .button:hover {
                background: #1DA851;
              }
              .footer {
                background: #F0F2F5;
                padding: 20px;
                text-align: center;
                color: #54656F;
                font-size: 14px;
              }
              .steps {
                margin: 20px 0;
                padding-left: 20px;
              }
              .steps li {
                margin: 10px 0;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>WhatsApp Connection Update</h1>
              </div>
              
              <div class="content">
                <p>Hello ${userName},</p>
                
                <p>We noticed that your WhatsApp connection for <strong>${locationName}</strong> has been ${disconnectReason}.</p>
                
                <div class="alert-box">
                  <strong>Connection Status Update</strong>
                  Your WhatsApp integration needs to be reconnected to continue functioning properly.
                </div>
                
                <div class="info-box">
                  <div class="info-row">
                    <span><strong>Account:</strong></span>
                    <span>${locationName}</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Disconnected:</strong></span>
                    <span>${details?.timestamp ? new Date(details.timestamp).toLocaleString() : new Date().toLocaleString()}</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Reason:</strong></span>
                    <span>${emailType === 'system_dashboard' ? 'System Disconnect' : emailType === 'mobile' ? 'Mobile disconnect' : 'Dashboard logout'}</span>
                  </div>
                  ${details && details.reason ? `
                  <div class="info-row">
                    <span><strong>Error Details:</strong></span>
                    <span>${details.reason}</span>
                  </div>
                  ` : ''}
                  ${details && details.code ? `
                  <div class="info-row">
                    <span><strong>Error Code:</strong></span>
                    <span>${details.code}</span>
                  </div>
                  ` : ''}
                </div>
                
                ${emailType === 'system_dashboard' ? `
                <div class="alert-box" style="background: #FFF3E0; border-left-color: #FF9800;">
                  <strong>⚠️ System Disconnect Detected</strong>
                  <p>Your WhatsApp connection was lost due to a system issue. The connection is now shown as <strong>"disconnected"</strong> on your dashboard. Our system is automatically attempting to reconnect. If the issue persists, please reconnect manually using the steps below.</p>
                </div>
                ` : ''}
                
                <p><strong>To reconnect your WhatsApp:</strong></p>
                <ol class="steps">
                  <li>Go to your <strong>Dashboard</strong></li>
                  <li>Find your subaccount: <strong>${locationName}</strong></li>
                  <li>Click the <strong>"QR Code"</strong> button</li>
                  <li>Scan the QR code with your WhatsApp mobile app</li>
                  <li>Wait for the connection to be established</li>
                </ol>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard" class="button">
                    Open Dashboard
                  </a>
                </div>
                
                <p style="color: #54656F; font-size: 14px; margin-top: 30px;">
                  <strong>Need help?</strong> If you continue to experience connection issues, please contact support.
                </p>
              </div>
              
              <div class="footer">
                <p>This is an automated notification from <strong>Octendr</strong></p>
                <p>WhatsApp GHL Integration Platform</p>
                <p style="margin-top: 15px; font-size: 12px; color: #999;">
                  <a href="${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard?unsubscribe=1" style="color: #54656F; text-decoration: none;">
                    Manage Email Preferences
                  </a>
                </p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textContent = `
WhatsApp Connection Update - Action Required

Hello ${userName},

We noticed that your WhatsApp connection for ${locationName} has been ${disconnectReason}.

Account: ${locationName}
Disconnected: ${details?.timestamp ? new Date(details.timestamp).toLocaleString() : new Date().toLocaleString()}
Reason: ${emailType === 'system_dashboard' ? 'System Disconnect' : emailType === 'mobile' ? 'Mobile disconnect' : 'Dashboard logout'}
${details && details.reason ? `Error: ${details.reason}\n` : ''}
${details && details.code ? `Error Code: ${details.code}\n` : ''}
${emailType === 'system_dashboard' ? '\n⚠️ System Disconnect: Your connection was lost due to a system issue and is now showing as "disconnected" on your dashboard. Our system is automatically attempting to reconnect.\n' : ''}

To reconnect:
1. Go to your Dashboard
2. Find your subaccount: ${locationName}
3. Click the "QR Code" button
4. Scan the QR code with your WhatsApp mobile app
5. Wait for connection to be established

Dashboard: ${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard

This is an automated notification from Octendr.

To manage your email preferences: ${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard?unsubscribe=1
      `;

      // Use Supabase Edge Function or external email service
      // For now, we'll use a simple HTTP email service (Resend, SendGrid, etc.)
      const emailResult = await this.sendEmailViaAPI({
        to: user.email,
        subject: subject,
        html: htmlContent,
        text: textContent
      });

      if (emailResult.success) {
        console.log(`✅ Disconnect email sent successfully to: ${user.email}`);
        return { success: true, email: user.email };
      } else {
        console.error(`❌ Failed to send disconnect email:`, emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ Error sending disconnect email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email via external API (Resend, SendGrid, etc.)
   * You can replace this with your preferred email service
   */
  async sendEmailViaAPI({ to, subject, html, text }) {
    try {
      // Option 1: Use Resend API (recommended - free tier available)
      if (process.env.RESEND_API_KEY) {
        // Node.js 18+ has built-in fetch, otherwise use node-fetch
        const fetch = global.fetch || require('node-fetch');
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'Octendr <notifications@octendr.com>',
            to: [to],
            subject: subject,
            html: html,
            text: text,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✅ Email sent via Resend:', data.id);
          return { success: true };
        } else {
          const error = await response.text();
          console.error('❌ Resend API error:', error);
          return { success: false, error: error };
        }
      }

      // Option 2: Use SendGrid API
      if (process.env.SENDGRID_API_KEY) {
        // Node.js 18+ has built-in fetch, otherwise use node-fetch
        const fetch = global.fetch || require('node-fetch');
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{
              to: [{ email: to }],
            }],
            from: { email: process.env.EMAIL_FROM || 'notifications@octendr.com' },
            subject: subject,
            content: [
              { type: 'text/plain', value: text },
              { type: 'text/html', value: html },
            ],
          }),
        });

        if (response.ok) {
          console.log('✅ Email sent via SendGrid');
          return { success: true };
        } else {
          const error = await response.text();
          console.error('❌ SendGrid API error:', error);
          return { success: false, error: error };
        }
      }

      // Option 3: Use Nodemailer with SMTP (Gmail, etc.)
      if (process.env.SMTP_HOST || process.env.SMTP_USER) {
        // Dynamically require nodemailer (install if needed)
        let nodemailer;
        try {
          nodemailer = require('nodemailer');
        } catch (e) {
          console.error('❌ nodemailer not installed. Run: npm install nodemailer');
          return { success: false, error: 'nodemailer package not installed' };
        }
        
        // Gmail SMTP configuration
        const isGmail = !process.env.SMTP_HOST || process.env.SMTP_HOST === 'smtp.gmail.com';
        const smtpPort = parseInt(process.env.SMTP_PORT || '587');
        
        const smtpConfig = {
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: smtpPort,
          secure: smtpPort === 465, // true for 465 (SSL), false for 587 (TLS)
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS, // Gmail App Password (not regular password)
          },
          // Gmail specific settings for better deliverability and security
          tls: {
            rejectUnauthorized: process.env.NODE_ENV === 'production', // Verify certificates in production
            minVersion: 'TLSv1.2', // Use modern TLS version
          },
          // Connection timeout
          connectionTimeout: 10000, // Increased to 10 seconds for Gmail
          greetingTimeout: 10000,
          socketTimeout: 10000,
          // Rate limiting to avoid spam detection (Gmail has strict limits)
          pool: true,
          maxConnections: 1,
          maxMessages: 5, // Gmail allows up to 500 emails/day, so 5 per connection is safe
          rateDelta: 1000, // Wait 1 second between messages
          rateLimit: 5, // Max 5 messages per rateDelta
        };

        // If using Gmail, add service option and optimize settings
        if (isGmail) {
          smtpConfig.service = 'gmail';
          // Additional Gmail optimizations
          smtpConfig.requireTLS = true; // Force TLS for Gmail
          console.log('📧 Using Gmail SMTP configuration');
          console.log('⚠️ Make sure you are using a Gmail App Password, not your regular Gmail password');
          console.log('   To create App Password: Google Account → Security → 2-Step Verification → App Passwords');
        }

        const transporter = nodemailer.createTransport(smtpConfig);

        // Verify connection
        try {
          await transporter.verify();
          console.log('✅ SMTP server connection verified');
          if (isGmail) {
            console.log('✅ Gmail SMTP authentication successful');
          }
        } catch (verifyError) {
          console.error('❌ SMTP verification failed:', verifyError.message);
          
          // Provide helpful error messages for Gmail
          let errorMessage = `SMTP connection failed: ${verifyError.message}`;
          if (isGmail) {
            if (verifyError.message.includes('Invalid login') || verifyError.message.includes('535')) {
              errorMessage = `Gmail authentication failed. Make sure you are using a Gmail App Password (not your regular password). To create one: Google Account → Security → 2-Step Verification → App Passwords`;
            } else if (verifyError.message.includes('EAUTH') || verifyError.message.includes('authentication')) {
              errorMessage = `Gmail authentication error. Verify your SMTP_USER and SMTP_PASS are correct. Use App Password, not regular password.`;
            } else if (verifyError.message.includes('ECONNECTION') || verifyError.message.includes('ETIMEDOUT')) {
              errorMessage = `Gmail connection timeout. Check your network/firewall settings. Port ${smtpPort} should be open.`;
            }
          }
          
          return { 
            success: false, 
            error: errorMessage
          };
        }

        const mailOptions = {
          from: process.env.EMAIL_FROM || `Octendr <${process.env.SMTP_USER}>`,
          to: to,
          subject: subject,
          html: html,
          text: text,
          // Spam prevention headers
          headers: {
            'X-Priority': '1',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'normal',
            'List-Unsubscribe': `<${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard?unsubscribe=1>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'X-Mailer': 'Octendr Notification System',
            'Precedence': 'bulk',
            'Auto-Submitted': 'auto-generated',
          },
          // Reply-to header (optional - defaults to sender email if not set)
          ...(process.env.EMAIL_REPLY_TO && { replyTo: process.env.EMAIL_REPLY_TO }),
          // Priority settings
          priority: 'normal',
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent via SMTP:', info.messageId);
        return { success: true, messageId: info.messageId };
      }

      // If no email service configured, log and return
      console.warn('⚠️ No email service configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or SMTP settings in .env');
      return { success: false, error: 'No email service configured' };

    } catch (error) {
      console.error('❌ Email API error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send trial reminder email (3 days left, 1 day left)
   * @param {string} userId - User ID
   * @param {number} daysLeft - Days remaining in trial
   */
  async sendTrialReminder(userId, daysLeft) {
    try {
      console.log(`📧 Preparing trial reminder email for user: ${userId}, days left: ${daysLeft}`);

      const { data: user, error: userError } = await this.supabaseAdmin
        .from('users')
        .select('id, email, name, trial_ends_at')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        console.error('❌ Failed to fetch user for trial reminder:', userError);
        return { success: false, error: 'User not found' };
      }

      if (!user.email) {
        console.error('❌ User email not found');
        return { success: false, error: 'User email not available' };
      }

      const userName = user.name || user.email.split('@')[0];
      const trialEndDate = user.trial_ends_at ? new Date(user.trial_ends_at).toLocaleDateString() : 'soon';

      const subject = daysLeft === 1 
        ? `⏰ Final Reminder: Your Trial Ends Tomorrow!`
        : `⏰ Trial Reminder: ${daysLeft} Days Left`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trial Reminder</title>
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
              .alert-box {
                background: ${daysLeft === 1 ? '#FFF3E0' : '#E3F2FD'};
                border-left: 4px solid ${daysLeft === 1 ? '#FF9800' : '#2196F3'};
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .alert-box strong {
                color: ${daysLeft === 1 ? '#E65100' : '#1565C0'};
                display: block;
                margin-bottom: 10px;
                font-size: 18px;
              }
              .button {
                display: inline-block;
                background: #25D366;
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 20px 0;
                text-align: center;
              }
              .button:hover {
                background: #1DA851;
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
                <h1>⏰ Trial Reminder</h1>
              </div>
              
              <div class="content">
                <p>Hello ${userName},</p>
                
                <div class="alert-box">
                  <strong>${daysLeft === 1 ? 'Final Reminder!' : 'Trial Ending Soon'}</strong>
                  Your ${daysLeft === 1 ? 'trial ends tomorrow' : `free trial has ${daysLeft} days remaining`}. Upgrade now to continue using WhatsApp Integration without interruption.
                </div>
                
                <p><strong>Trial End Date:</strong> ${trialEndDate}</p>
                
                <p>To avoid service interruption, please upgrade your plan before your trial expires.</p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/subscription" class="button">
                    Upgrade Now
                  </a>
                </div>
                
                <p style="color: #54656F; font-size: 14px; margin-top: 30px;">
                  <strong>Benefits of upgrading:</strong><br>
                  • Unlimited subaccounts<br>
                  • Priority support<br>
                  • Advanced features<br>
                  • No service interruption
                </p>
              </div>
              
              <div class="footer">
                <p>This is an automated notification from <strong>Octendr</strong></p>
                <p>WhatsApp GHL Integration Platform</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textContent = `
Trial Reminder - ${daysLeft === 1 ? 'Final Reminder!' : `${daysLeft} Days Left`}

Hello ${userName},

Your free trial has ${daysLeft === 1 ? '1 day remaining' : `${daysLeft} days remaining`}. Trial ends on: ${trialEndDate}

Upgrade now to continue using WhatsApp Integration without interruption.

Upgrade: ${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/subscription

This is an automated notification from Octendr.
      `;

      const emailResult = await this.sendEmailViaAPI({
        to: user.email,
        subject: subject,
        html: htmlContent,
        text: textContent
      });

      if (emailResult.success) {
        console.log(`✅ Trial reminder email sent successfully to: ${user.email}`);
        return { success: true, email: user.email };
      } else {
        console.error(`❌ Failed to send trial reminder email:`, emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ Error sending trial reminder email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send trial expired email notification
   * @param {string} userId - User ID
   */
  async sendTrialExpiredNotification(userId) {
    try {
      console.log(`📧 Preparing trial expired email for user: ${userId}`);

      const { data: user, error: userError } = await this.supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        console.error('❌ Failed to fetch user for trial expired email:', userError);
        return { success: false, error: 'User not found' };
      }

      if (!user.email) {
        console.error('❌ User email not found');
        return { success: false, error: 'User email not available' };
      }

      const userName = user.name || user.email.split('@')[0];

      const subject = '⚠️ Your Trial Has Expired - Upgrade Now';
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trial Expired</title>
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
                background: linear-gradient(135deg, #D32F2F 0%, #F57C00 100%);
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
              .alert-box {
                background: #FFEBEE;
                border-left: 4px solid #D32F2F;
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .alert-box strong {
                color: #C62828;
                display: block;
                margin-bottom: 10px;
                font-size: 18px;
              }
              .button {
                display: inline-block;
                background: #D32F2F;
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 20px 0;
                text-align: center;
              }
              .button:hover {
                background: #B71C1C;
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
                <h1>⚠️ Trial Expired</h1>
              </div>
              
              <div class="content">
                <p>Hello ${userName},</p>
                
                <div class="alert-box">
                  <strong>Your Trial Has Expired</strong>
                  Your free trial period has ended. To continue using WhatsApp Integration, please upgrade to a paid plan.
                </div>
                
                <p>Your subaccounts have been temporarily disabled. Upgrade now to restore access and continue using all features.</p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/subscription" class="button">
                    Upgrade Now
                  </a>
                </div>
                
                <p style="color: #54656F; font-size: 14px; margin-top: 30px;">
                  <strong>What happens after upgrade:</strong><br>
                  • All your subaccounts will be restored<br>
                  • Full access to all features<br>
                  • Priority support<br>
                  • No data loss
                </p>
              </div>
              
              <div class="footer">
                <p>This is an automated notification from <strong>Octendr</strong></p>
                <p>WhatsApp GHL Integration Platform</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textContent = `
Your Trial Has Expired

Hello ${userName},

Your free trial period has ended. To continue using WhatsApp Integration, please upgrade to a paid plan.

Your subaccounts have been temporarily disabled. Upgrade now to restore access.

Upgrade: ${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/subscription

This is an automated notification from Octendr.
      `;

      const emailResult = await this.sendEmailViaAPI({
        to: user.email,
        subject: subject,
        html: htmlContent,
        text: textContent
      });

      if (emailResult.success) {
        console.log(`✅ Trial expired email sent successfully to: ${user.email}`);
        return { success: true, email: user.email };
      } else {
        console.error(`❌ Failed to send trial expired email:`, emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ Error sending trial expired email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send subscription activation/welcome email
   * @param {string} userId - User ID
   * @param {string} planName - Plan name (starter, professional)
   */
  async sendSubscriptionActivationEmail(userId, planName) {
    try {
      console.log(`📧 Preparing subscription activation email for user: ${userId}, plan: ${planName}`);

      const { data: user, error: userError } = await this.supabaseAdmin
        .from('users')
        .select('id, email, name, max_subaccounts')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        console.error('❌ Failed to fetch user for subscription email:', userError);
        return { success: false, error: 'User not found' };
      }

      if (!user.email) {
        console.error('❌ User email not found');
        return { success: false, error: 'User email not available' };
      }

      const userName = user.name || user.email.split('@')[0];
      const planDisplayName = planName === 'starter' ? 'Starter Plan' : planName === 'professional' ? 'Professional Plan' : planName;
      const planPrice = planName === 'starter' ? '$19' : planName === 'professional' ? '$49' : 'N/A';

      const subject = `🎉 Welcome to ${planDisplayName} - Subscription Activated!`;
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Subscription Activated</title>
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
              .success-box {
                background: #E8F5E9;
                border-left: 4px solid #4CAF50;
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .success-box strong {
                color: #2E7D32;
                display: block;
                margin-bottom: 10px;
                font-size: 18px;
              }
              .info-box {
                background: #F0F2F5;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
              }
              .info-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #E9EDEF;
              }
              .info-row:last-child {
                border-bottom: none;
              }
              .button {
                display: inline-block;
                background: #25D366;
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 20px 0;
                text-align: center;
              }
              .button:hover {
                background: #1DA851;
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
                <h1>🎉 Subscription Activated!</h1>
              </div>
              
              <div class="content">
                <p>Hello ${userName},</p>
                
                <div class="success-box">
                  <strong>✅ Payment Successful!</strong>
                  Your ${planDisplayName} subscription has been activated successfully. You now have full access to all features.
                </div>
                
                <div class="info-box">
                  <div class="info-row">
                    <span><strong>Plan:</strong></span>
                    <span>${planDisplayName}</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Price:</strong></span>
                    <span>${planPrice}/month</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Subaccounts:</strong></span>
                    <span>${user.max_subaccounts || 0} allowed</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Status:</strong></span>
                    <span style="color: #4CAF50; font-weight: 600;">Active</span>
                  </div>
                </div>
                
                <p><strong>What's Next?</strong></p>
                <ul style="color: #54656F; line-height: 1.8;">
                  <li>Add and manage your LeadConnector subaccounts</li>
                  <li>Connect WhatsApp Business accounts</li>
                  <li>Start sending and receiving messages</li>
                  <li>Access all premium features</li>
                </ul>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard" class="button">
                    Go to Dashboard
                  </a>
                </div>
                
                <p style="color: #54656F; font-size: 14px; margin-top: 30px;">
                  <strong>Need help?</strong> If you have any questions, please contact our support team.
                </p>
              </div>
              
              <div class="footer">
                <p>This is an automated notification from <strong>Octendr</strong></p>
                <p>WhatsApp GHL Integration Platform</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textContent = `
Subscription Activated - Welcome to ${planDisplayName}!

Hello ${userName},

Your ${planDisplayName} subscription has been activated successfully. Your payment was processed and you now have full access to all features.

Plan: ${planDisplayName}
Price: ${planPrice}/month
Subaccounts: ${user.max_subaccounts || 0} allowed
Status: Active

What's Next?
- Add and manage your LeadConnector subaccounts
- Connect WhatsApp Business accounts
- Start sending and receiving messages
- Access all premium features

Dashboard: ${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard

This is an automated notification from Octendr.
      `;

      const emailResult = await this.sendEmailViaAPI({
        to: user.email,
        subject: subject,
        html: htmlContent,
        text: textContent
      });

      if (emailResult.success) {
        console.log(`✅ Subscription activation email sent successfully to: ${user.email}`);
        return { success: true, email: user.email };
      } else {
        console.error(`❌ Failed to send subscription activation email:`, emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ Error sending subscription activation email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send payment failed email notification
   * @param {string} userId - User ID
   * @param {object} invoiceData - Invoice data from Stripe
   */
  async sendPaymentFailedEmail(userId, invoiceData) {
    try {
      console.log(`📧 Preparing payment failed email for user: ${userId}`);

      const { data: user, error: userError } = await this.supabaseAdmin
        .from('users')
        .select('id, email, name, subscription_plan')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        console.error('❌ Failed to fetch user for payment failed email:', userError);
        return { success: false, error: 'User not found' };
      }

      if (!user.email) {
        console.error('❌ User email not found');
        return { success: false, error: 'User email not available' };
      }

      const userName = user.name || user.email.split('@')[0];
      const planName = user.subscription_plan === 'starter' ? 'Starter Plan' : user.subscription_plan === 'professional' ? 'Professional Plan' : user.subscription_plan;
      const amountDue = invoiceData.amount_due ? `$${(invoiceData.amount_due / 100).toFixed(2)}` : 'N/A';
      const invoiceUrl = invoiceData.hosted_invoice_url || invoiceData.invoice_pdf || null;

      const subject = '⚠️ Payment Failed - Action Required';
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Failed</title>
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
                background: linear-gradient(135deg, #D32F2F 0%, #F57C00 100%);
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
              .alert-box {
                background: #FFEBEE;
                border-left: 4px solid #D32F2F;
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .alert-box strong {
                color: #C62828;
                display: block;
                margin-bottom: 10px;
                font-size: 18px;
              }
              .info-box {
                background: #F0F2F5;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
              }
              .info-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #E9EDEF;
              }
              .info-row:last-child {
                border-bottom: none;
              }
              .button {
                display: inline-block;
                background: #D32F2F;
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 20px 0;
                text-align: center;
              }
              .button:hover {
                background: #B71C1C;
              }
              .button-secondary {
                display: inline-block;
                background: #54656F;
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 10px 5px;
                text-align: center;
              }
              .button-secondary:hover {
                background: #42505A;
              }
              .footer {
                background: #F0F2F5;
                padding: 20px;
                text-align: center;
                color: #54656F;
                font-size: 14px;
              }
              .warning-list {
                background: #FFF3E0;
                border-left: 4px solid #FF9800;
                padding: 15px 20px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .warning-list ul {
                margin: 10px 0;
                padding-left: 20px;
              }
              .warning-list li {
                margin: 8px 0;
                color: #E65100;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚠️ Payment Failed</h1>
              </div>
              
              <div class="content">
                <p>Hello ${userName},</p>
                
                <div class="alert-box">
                  <strong>Payment Failed</strong>
                  We were unable to process your payment for your ${planName} subscription. Please update your payment method to continue using our services.
                </div>
                
                <div class="info-box">
                  <div class="info-row">
                    <span><strong>Plan:</strong></span>
                    <span>${planName}</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Amount Due:</strong></span>
                    <span style="color: #D32F2F; font-weight: 600;">${amountDue}</span>
                  </div>
                  <div class="info-row">
                    <span><strong>Status:</strong></span>
                    <span style="color: #D32F2F; font-weight: 600;">Payment Failed</span>
                  </div>
                </div>
                
                <div class="warning-list">
                  <strong style="color: #E65100; display: block; margin-bottom: 10px;">⚠️ Important:</strong>
                  <ul>
                    <li>Your subscription may be suspended if payment is not updated</li>
                    <li>All your subaccounts will be temporarily disabled</li>
                    <li>Update your payment method to restore access immediately</li>
                  </ul>
                </div>
                
                <p><strong>What to do:</strong></p>
                <ol style="color: #54656F; line-height: 1.8; padding-left: 20px;">
                  <li>Check your payment method (card may have expired or insufficient funds)</li>
                  <li>Update your payment information in the billing section</li>
                  <li>Retry the payment</li>
                </ol>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${invoiceUrl || `${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/billing`}" class="button">
                    ${invoiceUrl ? 'View Invoice & Pay' : 'Update Payment Method'}
                  </a>
                  ${invoiceUrl ? `<br><a href="${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/billing" class="button-secondary" style="margin-top: 10px;">
                    Go to Billing
                  </a>` : ''}
                </div>
                
                <p style="color: #54656F; font-size: 14px; margin-top: 30px;">
                  <strong>Need help?</strong> If you continue to experience payment issues, please contact our support team.
                </p>
              </div>
              
              <div class="footer">
                <p>This is an automated notification from <strong>Octendr</strong></p>
                <p>WhatsApp GHL Integration Platform</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textContent = `
Payment Failed - Action Required

Hello ${userName},

We were unable to process your payment for your ${planName} subscription.

Plan: ${planName}
Amount Due: ${amountDue}
Status: Payment Failed

⚠️ Important:
- Your subscription may be suspended if payment is not updated
- All your subaccounts will be temporarily disabled
- Update your payment method to restore access immediately

What to do:
1. Check your payment method (card may have expired or insufficient funds)
2. Update your payment information in the billing section
3. Retry the payment

${invoiceUrl ? `Invoice: ${invoiceUrl}` : `Billing: ${process.env.FRONTEND_URL || 'https://dashboard.octendr.com'}/dashboard/billing`}

This is an automated notification from Octendr.
      `;

      const emailResult = await this.sendEmailViaAPI({
        to: user.email,
        subject: subject,
        html: htmlContent,
        text: textContent
      });

      if (emailResult.success) {
        console.log(`✅ Payment failed email sent successfully to: ${user.email}`);
        return { success: true, email: user.email };
      } else {
        console.error(`❌ Failed to send payment failed email:`, emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ Error sending payment failed email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send internal notification to admin when a user makes a payment
   * @param {object} paymentData - Payment details
   * @param {string} paymentData.userId - User ID
   * @param {string} paymentData.userEmail - User email
   * @param {string} paymentData.userName - User name
   * @param {string} paymentData.planName - Plan name (starter, professional)
   * @param {string} paymentData.paymentType - Payment type (recurring, one-time)
   * @param {string} paymentData.stripeSessionId - Stripe session ID
   * @param {string} paymentData.stripeCustomerId - Stripe customer ID
   */
  async sendInternalPaymentNotification(paymentData) {
    try {
      const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER;
      
      if (!adminEmail) {
        console.log('⚠️ No admin email configured for internal notifications (set ADMIN_NOTIFY_EMAIL or SMTP_USER)');
        return { success: false, error: 'No admin email configured' };
      }

      const {
        userId,
        userEmail,
        userName,
        planName,
        paymentType,
        stripeSessionId,
        stripeCustomerId
      } = paymentData;

      const planDisplayName = planName === 'starter' ? 'Starter Plan ($19/mo)' : planName === 'professional' ? 'Professional Plan ($49/mo)' : planName;
      const planPrice = planName === 'starter' ? '$19' : planName === 'professional' ? '$49' : 'N/A';
      const maxSubs = planName === 'starter' ? 2 : planName === 'professional' ? 10 : 1;
      const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });

      console.log(`📧 Sending internal payment notification to admin: ${adminEmail}`);

      const subject = `💰 New Payment! ${userName || userEmail} → ${planDisplayName}`;
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Payment Notification</title>
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
                background: linear-gradient(135deg, #1B5E20 0%, #4CAF50 100%);
                padding: 30px;
                text-align: center;
                color: white;
              }
              .header h1 {
                margin: 0;
                font-size: 24px;
                font-weight: 700;
              }
              .header p {
                margin: 8px 0 0;
                font-size: 14px;
                opacity: 0.9;
              }
              .content {
                padding: 30px;
              }
              .payment-badge {
                background: #E8F5E9;
                border: 2px solid #4CAF50;
                border-radius: 12px;
                padding: 20px;
                text-align: center;
                margin: 20px 0;
              }
              .payment-badge .amount {
                font-size: 36px;
                font-weight: 700;
                color: #2E7D32;
                margin: 0;
              }
              .payment-badge .label {
                font-size: 14px;
                color: #666;
                margin: 5px 0 0;
              }
              .info-table {
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
              }
              .info-table td {
                padding: 12px 15px;
                border-bottom: 1px solid #E9EDEF;
              }
              .info-table td:first-child {
                font-weight: 600;
                color: #555;
                width: 40%;
              }
              .info-table td:last-child {
                color: #333;
              }
              .plan-badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-weight: 600;
                font-size: 13px;
              }
              .plan-starter {
                background: #E3F2FD;
                color: #1565C0;
              }
              .plan-professional {
                background: #F3E5F5;
                color: #7B1FA2;
              }
              .footer {
                background: #F0F2F5;
                padding: 15px;
                text-align: center;
                color: #999;
                font-size: 12px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>💰 New Payment Received!</h1>
                <p>${now}</p>
              </div>
              
              <div class="content">
                <div class="payment-badge">
                  <p class="amount">${planPrice}/mo</p>
                  <p class="label">${paymentType === 'one-time' ? 'One-Time Payment' : 'Recurring Subscription'}</p>
                </div>
                
                <table class="info-table">
                  <tr>
                    <td>👤 User</td>
                    <td>${userName || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td>📧 Email</td>
                    <td>${userEmail || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td>📋 Plan</td>
                    <td><span class="plan-badge ${planName === 'starter' ? 'plan-starter' : 'plan-professional'}">${planDisplayName}</span></td>
                  </tr>
                  <tr>
                    <td>💳 Payment Type</td>
                    <td>${paymentType === 'one-time' ? 'One-Time' : 'Recurring'}</td>
                  </tr>
                  <tr>
                    <td>📊 Max Subaccounts</td>
                    <td>${maxSubs}</td>
                  </tr>
                  <tr>
                    <td>🆔 User ID</td>
                    <td style="font-size: 12px; font-family: monospace;">${userId || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td>🔗 Stripe Customer</td>
                    <td style="font-size: 12px; font-family: monospace;">${stripeCustomerId || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td>📝 Session ID</td>
                    <td style="font-size: 12px; font-family: monospace;">${stripeSessionId || 'N/A'}</td>
                  </tr>
                </table>
              </div>
              
              <div class="footer">
                <p>Internal notification — Octendr Admin</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textContent = `
💰 New Payment Received!
${now}

User: ${userName || 'N/A'}
Email: ${userEmail || 'N/A'}
Plan: ${planDisplayName}
Payment Type: ${paymentType === 'one-time' ? 'One-Time' : 'Recurring'}  
Max Subaccounts: ${maxSubs}
User ID: ${userId || 'N/A'}
Stripe Customer: ${stripeCustomerId || 'N/A'}
Session ID: ${stripeSessionId || 'N/A'}

— Octendr Admin Notification
      `;

      const emailResult = await this.sendEmailViaAPI({
        to: adminEmail,
        subject: subject,
        html: htmlContent,
        text: textContent
      });

      if (emailResult.success) {
        console.log(`✅ Internal payment notification sent to admin: ${adminEmail}`);
        return { success: true, email: adminEmail };
      } else {
        console.error(`❌ Failed to send internal payment notification:`, emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ Error sending internal payment notification:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();

