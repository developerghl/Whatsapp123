const { createClient } = require('@supabase/supabase-js')

class EmailService {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    this.supabaseAdmin = createClient(this.supabaseUrl, this.supabaseKey)
    this.appUrl = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.octendr.com'
  }

  // ─── Shared Minimal Template ───

  /**
   * Minimal email template — matches the Next.js mailer design system.
   * Single source of truth for all Octendr emails.
   */
  getEmailTemplate({ headerTitle, headerSubtitle, content, buttonText, buttonUrl, footerText }) {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6; color: #1a1a1a; background-color: #f5f5f5; padding: 20px;
            }
            .email-container {
              max-width: 560px; margin: 0 auto; background-color: #ffffff;
              border-radius: 8px; overflow: hidden; border: 1px solid #e5e5e5;
            }
            .header { padding: 32px 32px 24px; border-bottom: 1px solid #f0f0f0; }
            .brand {
              font-size: 13px; font-weight: 600; color: #25D366;
              text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px;
            }
            .header h1 { font-size: 22px; font-weight: 600; color: #1a1a1a; margin: 0; line-height: 1.3; }
            .header p { color: #737373; font-size: 14px; margin-top: 6px; }
            .content { padding: 28px 32px; }
            .content p { margin: 0 0 16px 0; font-size: 15px; color: #404040; line-height: 1.7; }
            .content p:last-child { margin-bottom: 0; }
            .button-container { text-align: left; margin: 24px 0; }
            .button {
              display: inline-block; background: #1a1a1a; color: #ffffff !important;
              padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;
            }
            .detail-table {
              width: 100%; margin: 20px 0; border: 1px solid #e5e5e5;
              border-radius: 6px; border-collapse: separate; border-spacing: 0; overflow: hidden;
            }
            .detail-table td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f0f0f0; }
            .detail-table tr:last-child td { border-bottom: none; }
            .detail-table .label { color: #737373; font-weight: 500; width: 120px; background: #fafafa; }
            .detail-table .value {
              color: #1a1a1a; font-weight: 500; font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
              font-size: 13px; word-break: break-all;
            }
            .notice {
              background: #fafafa; border-radius: 6px; padding: 16px; margin: 20px 0;
              font-size: 14px; color: #525252; line-height: 1.6;
            }
            .notice.warn { border-left: 3px solid #f59e0b; }
            .notice.error { border-left: 3px solid #ef4444; }
            .notice.success { border-left: 3px solid #25D366; }
            .notice strong { color: #1a1a1a; display: block; margin-bottom: 4px; }
            .list { margin: 12px 0; padding-left: 20px; }
            .list li { margin: 6px 0; font-size: 14px; color: #404040; }
            .footer { padding: 24px 32px; border-top: 1px solid #f0f0f0; }
            .footer p { color: #a3a3a3; font-size: 12px; margin: 0; }
            .footer a { color: #737373; text-decoration: none; }
            .muted { color: #737373 !important; font-size: 13px !important; }
            @media only screen and (max-width: 600px) {
              body { padding: 10px; }
              .content, .header, .footer { padding-left: 20px; padding-right: 20px; }
              .header h1 { font-size: 20px; }
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="brand">Octendr</div>
              <h1>${headerTitle}</h1>
              ${headerSubtitle ? `<p>${headerSubtitle}</p>` : ''}
            </div>
            <div class="content">
              ${content}
              ${buttonText && buttonUrl ? `
                <div class="button-container">
                  <a href="${buttonUrl}" class="button">${buttonText}</a>
                </div>
              ` : ''}
              ${footerText ? `<p class="muted" style="margin-top: 20px;">${footerText}</p>` : ''}
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Octendr &middot; <a href="mailto:support@octendr.com">support@octendr.com</a></p>
            </div>
          </div>
        </body>
      </html>
    `
  }

  // ─── Helpers ───

  async getUser(userId, extraFields = '') {
    const fields = `id, email, name${extraFields ? ', ' + extraFields : ''}`
    const { data, error } = await this.supabaseAdmin
      .from('users')
      .select(fields)
      .eq('id', userId)
      .maybeSingle()

    if (error || !data?.email) {
      console.error('Failed to fetch user:', error || 'No email')
      return null
    }
    data.displayName = data.name || data.email.split('@')[0]
    return data
  }

  formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    })
  }

  // ─── Password Reset ───

  async sendPasswordResetOTP(email, otp, name) {
    const displayName = name || email.split('@')[0]

    const content = `
      <p>Hi ${displayName},</p>
      <p>Use the code below to reset your password.</p>
      <div style="text-align: center; padding: 24px; margin: 20px 0; background: #fafafa; border-radius: 6px;">
        <div style="font-size: 36px; font-weight: 700; color: #1a1a1a; letter-spacing: 8px; font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;">${otp}</div>
        <div style="font-size: 13px; color: #737373; margin-top: 8px;">Expires in 10 minutes</div>
      </div>
      <p class="muted">If you didn't request this, you can safely ignore this email.</p>
    `

    return this.sendEmailViaAPI({
      to: email,
      subject: 'Reset your password',
      html: this.getEmailTemplate({
        headerTitle: 'Password Reset',
        content,
      }),
      text: `Hi ${displayName}, your password reset code is: ${otp}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
    })
  }

  // ─── WhatsApp Disconnect Emails ───

  async sendDailyDisconnectReminder(userId, locationId) {
    const user = await this.getUser(userId)
    if (!user) return { success: false, error: 'User not found' }

    const content = `
      <p>Hi ${user.displayName},</p>
      <p>Your WhatsApp connection for <strong>${locationId}</strong> is still disconnected. Scheduled messages and auto-replies are paused.</p>
      <div class="notice warn">
        <strong>Action needed</strong>
        Log in to your dashboard and scan the QR code from your WhatsApp app to reconnect.
      </div>
    `

    return this.sendEmailViaAPI({
      to: user.email,
      subject: 'WhatsApp is disconnected',
      html: this.getEmailTemplate({
        headerTitle: 'Connection Reminder',
        headerSubtitle: `Location: ${locationId}`,
        content,
        buttonText: 'Reconnect Now',
        buttonUrl: `${this.appUrl}/dashboard`,
        footerText: 'This is an automated daily reminder.',
      }),
      text: `Hi ${user.displayName}, your WhatsApp for ${locationId} is disconnected. Log in at ${this.appUrl} to reconnect.`,
    })
  }

  async sendDisconnectNotification(userId, locationId, reason = 'mobile', details = null) {
    const user = await this.getUser(userId)
    if (!user) return { success: false, error: 'User not found' }

    const reasons = {
      mobile: { label: 'Mobile disconnect', desc: 'disconnected from your mobile phone' },
      dashboard: { label: 'Dashboard logout', desc: 'logged out from the dashboard' },
      system_dashboard: { label: 'System issue', desc: 'lost due to a system issue' },
    }
    const r = reasons[reason] || reasons.mobile

    let detailRows = `
      <tr><td class="label">Location</td><td class="value" style="font-family: inherit;">${locationId}</td></tr>
      <tr><td class="label">Reason</td><td class="value" style="font-family: inherit;">${r.label}</td></tr>
      <tr><td class="label">Time</td><td class="value">${details?.timestamp ? new Date(details.timestamp).toLocaleString() : new Date().toLocaleString()}</td></tr>
    `
    if (details?.reason) {
      detailRows += `<tr><td class="label">Details</td><td class="value">${details.reason}</td></tr>`
    }
    if (details?.code) {
      detailRows += `<tr><td class="label">Error code</td><td class="value">${details.code}</td></tr>`
    }

    const systemNote = reason === 'system_dashboard'
      ? `<div class="notice warn"><strong>Automatic reconnect in progress</strong>Our system is attempting to restore your connection. If it stays disconnected, please reconnect manually.</div>`
      : ''

    const content = `
      <p>Hi ${user.displayName},</p>
      <p>Your WhatsApp connection for <strong>${locationId}</strong> has been ${r.desc}.</p>
      <table class="detail-table">${detailRows}</table>
      ${systemNote}
      <p><strong>To reconnect:</strong></p>
      <ol class="list">
        <li>Open your dashboard</li>
        <li>Find the subaccount for ${locationId}</li>
        <li>Click "QR Code" and scan with WhatsApp</li>
      </ol>
    `

    const result = await this.sendEmailViaAPI({
      to: user.email,
      subject: reason === 'system_dashboard'
        ? 'WhatsApp connection lost'
        : 'WhatsApp disconnected — action required',
      html: this.getEmailTemplate({
        headerTitle: 'WhatsApp Disconnected',
        content,
        buttonText: 'Open Dashboard',
        buttonUrl: `${this.appUrl}/dashboard`,
        footerText: 'Need help? Contact support@octendr.com',
      }),
      text: `Hi ${user.displayName}, your WhatsApp for ${locationId} was ${r.desc}. Reconnect at ${this.appUrl}/dashboard`,
    })

    if (result.success) console.log(`Disconnect email sent to: ${user.email}`)
    return result
  }

  // ─── Trial Emails ───

  async sendTrialReminder(userId, daysLeft) {
    const user = await this.getUser(userId, 'trial_ends_at')
    if (!user) return { success: false, error: 'User not found' }

    const trialEndDate = user.trial_ends_at ? this.formatDate(user.trial_ends_at) : 'soon'
    const isFinal = daysLeft === 1

    const content = `
      <p>Hi ${user.displayName},</p>
      <p>Your free trial ends ${isFinal ? '<strong>tomorrow</strong>' : `in <strong>${daysLeft} days</strong>`} on ${trialEndDate}.</p>
      ${isFinal ? `
        <div class="notice warn">
          <strong>Last chance to upgrade</strong>
          Upgrade now to keep access to your subaccounts and workflows. Plans start at $19/month.
        </div>
      ` : `
        <p>To continue using Octendr without interruption, upgrade before your trial expires.</p>
      `}
    `

    return this.sendEmailViaAPI({
      to: user.email,
      subject: isFinal ? 'Your trial ends tomorrow' : `Your trial ends in ${daysLeft} days`,
      html: this.getEmailTemplate({
        headerTitle: isFinal ? 'Final Day of Your Trial' : `${daysLeft} Days Remaining`,
        content,
        buttonText: 'View Plans',
        buttonUrl: `${this.appUrl}/dashboard/subscription`,
      }),
      text: `Hi ${user.displayName}, your trial ends ${isFinal ? 'tomorrow' : `in ${daysLeft} days`}. Upgrade at ${this.appUrl}/dashboard/subscription`,
    })
  }

  async sendTrialExpiredNotification(userId) {
    const user = await this.getUser(userId)
    if (!user) return { success: false, error: 'User not found' }

    const content = `
      <p>Hi ${user.displayName},</p>
      <p>Your 7-day free trial has ended. To continue using Octendr, please upgrade to a paid plan.</p>
      <table class="detail-table">
        <tr><td class="label">Starter</td><td class="value" style="font-family: inherit;">$19/month — 2 Subaccounts</td></tr>
        <tr><td class="label">Professional</td><td class="value" style="font-family: inherit;">$49/month — 10 Subaccounts</td></tr>
      </table>
      <p class="muted">Your data is safe and will be available once you upgrade.</p>
    `

    return this.sendEmailViaAPI({
      to: user.email,
      subject: 'Your trial has ended',
      html: this.getEmailTemplate({
        headerTitle: 'Trial Ended',
        headerSubtitle: 'Upgrade to restore access',
        content,
        buttonText: 'View Plans',
        buttonUrl: `${this.appUrl}/dashboard/subscription`,
      }),
      text: `Hi ${user.displayName}, your trial has ended. Upgrade at ${this.appUrl}/dashboard/subscription`,
    })
  }

  // ─── Subscription Emails ───

  async sendSubscriptionActivationEmail(userId, planName) {
    const user = await this.getUser(userId, 'max_subaccounts')
    if (!user) return { success: false, error: 'User not found' }

    const plan = planName === 'professional'
      ? { name: 'Professional', price: '$49' }
      : { name: 'Starter', price: '$19' }

    const content = `
      <p>Hi ${user.displayName},</p>
      <div class="notice success">
        <strong>Payment confirmed</strong>
        Your ${plan.name} plan (${plan.price}/month) is now active.
      </div>
      <table class="detail-table">
        <tr><td class="label">Plan</td><td class="value" style="font-family: inherit;">${plan.name}</td></tr>
        <tr><td class="label">Price</td><td class="value" style="font-family: inherit;">${plan.price}/month</td></tr>
        <tr><td class="label">Subaccounts</td><td class="value" style="font-family: inherit;">${user.max_subaccounts || 0}</td></tr>
      </table>
    `

    return this.sendEmailViaAPI({
      to: user.email,
      subject: `${plan.name} plan activated`,
      html: this.getEmailTemplate({
        headerTitle: 'Subscription Activated',
        content,
        buttonText: 'Go to Dashboard',
        buttonUrl: `${this.appUrl}/dashboard`,
      }),
      text: `Hi ${user.displayName}, your ${plan.name} plan is now active. Dashboard: ${this.appUrl}/dashboard`,
    })
  }

  async sendPaymentFailedEmail(userId, invoiceData) {
    const user = await this.getUser(userId, 'subscription_plan')
    if (!user) return { success: false, error: 'User not found' }

    const planName = user.subscription_plan === 'professional' ? 'Professional' : 'Starter'
    const amountDue = invoiceData.amount_due ? `$${(invoiceData.amount_due / 100).toFixed(2)}` : 'N/A'
    const invoiceUrl = invoiceData.hosted_invoice_url || invoiceData.invoice_pdf || null
    const billingUrl = `${this.appUrl}/dashboard/billing`

    const content = `
      <p>Hi ${user.displayName},</p>
      <div class="notice error">
        <strong>Payment failed</strong>
        We could not process your payment for the ${planName} plan (${amountDue}).
      </div>
      <p>Please update your payment method to avoid service interruption. Your subaccounts may be temporarily disabled if the payment is not resolved.</p>
    `

    return this.sendEmailViaAPI({
      to: user.email,
      subject: 'Payment failed — action required',
      html: this.getEmailTemplate({
        headerTitle: 'Payment Unsuccessful',
        content,
        buttonText: invoiceUrl ? 'View Invoice' : 'Update Payment',
        buttonUrl: invoiceUrl || billingUrl,
        footerText: 'Need help? Contact support@octendr.com',
      }),
      text: `Hi ${user.displayName}, your payment of ${amountDue} for ${planName} failed. Update at ${billingUrl}`,
    })
  }

  // ─── Internal Admin Notification ───

  async sendInternalPaymentNotification(paymentData) {
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER
    if (!adminEmail) {
      console.log('No admin email configured, skipping internal notification')
      return { success: false, error: 'No admin email configured' }
    }

    const { userId, userEmail, userName, planName, paymentType, stripeSessionId, stripeCustomerId } = paymentData
    const plan = planName === 'professional' ? 'Professional ($49/mo)' : 'Starter ($19/mo)'

    const content = `
      <p>A customer has subscribed.</p>
      <table class="detail-table">
        <tr><td class="label">Name</td><td class="value" style="font-family: inherit;">${userName || '—'}</td></tr>
        <tr><td class="label">Email</td><td class="value">${userEmail || '—'}</td></tr>
        <tr><td class="label">Plan</td><td class="value" style="font-family: inherit;">${plan}</td></tr>
        <tr><td class="label">Type</td><td class="value" style="font-family: inherit;">${paymentType === 'one-time' ? 'One-time' : 'Recurring'}</td></tr>
        <tr><td class="label">User ID</td><td class="value">${userId || '—'}</td></tr>
        <tr><td class="label">Stripe ID</td><td class="value">${stripeCustomerId || '—'}</td></tr>
        <tr><td class="label">Session</td><td class="value">${stripeSessionId || '—'}</td></tr>
      </table>
    `

    return this.sendEmailViaAPI({
      to: adminEmail,
      subject: `New payment: ${userName || userEmail} — ${plan}`,
      html: this.getEmailTemplate({
        headerTitle: 'Payment Received',
        content,
      }),
      text: `New payment: ${userName || userEmail} subscribed to ${plan}. User ID: ${userId}`,
    })
  }

  // ─── Email Sender ───

  async sendEmailViaAPI({ to, subject, html, text }) {
    try {
      // Resend
      if (process.env.RESEND_API_KEY) {
        const fetch = global.fetch || require('node-fetch')
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'Octendr <notifications@octendr.com>',
            to: [to], subject, html, text,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          console.log('Email sent via Resend:', data.id)
          return { success: true }
        }
        const err = await res.text()
        console.error('Resend error:', err)
        return { success: false, error: err }
      }

      // SendGrid
      if (process.env.SENDGRID_API_KEY) {
        const fetch = global.fetch || require('node-fetch')
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: process.env.EMAIL_FROM || 'notifications@octendr.com' },
            subject,
            content: [
              { type: 'text/plain', value: text },
              { type: 'text/html', value: html },
            ],
          }),
        })
        if (res.ok) {
          console.log('Email sent via SendGrid')
          return { success: true }
        }
        const err = await res.text()
        console.error('SendGrid error:', err)
        return { success: false, error: err }
      }

      // SMTP / Nodemailer
      if (process.env.SMTP_HOST || process.env.SMTP_USER) {
        let nodemailer
        try { nodemailer = require('nodemailer') }
        catch { return { success: false, error: 'nodemailer not installed' } }

        const port = parseInt(process.env.SMTP_PORT || '587')
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port,
          secure: port === 465,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          tls: { rejectUnauthorized: process.env.NODE_ENV === 'production', minVersion: 'TLSv1.2' },
          connectionTimeout: 10000,
          pool: true,
          maxConnections: 1,
        })

        await transporter.verify()

        const info = await transporter.sendMail({
          from: process.env.EMAIL_FROM || `Octendr <${process.env.SMTP_USER}>`,
          to, subject, html, text,
          headers: {
            'List-Unsubscribe': `<${this.appUrl}/dashboard?unsubscribe=1>`,
            'Auto-Submitted': 'auto-generated',
          },
          ...(process.env.EMAIL_REPLY_TO && { replyTo: process.env.EMAIL_REPLY_TO }),
        })

        console.log('Email sent via SMTP:', info.messageId)
        return { success: true, messageId: info.messageId }
      }

      console.warn('No email service configured')
      return { success: false, error: 'No email service configured' }
    } catch (error) {
      console.error('Email send failed:', error)
      return { success: false, error: error.message }
    }
  }
}

module.exports = new EmailService()