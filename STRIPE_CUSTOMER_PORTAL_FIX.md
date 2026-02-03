# 🔧 Stripe Customer Portal Error Fix Guide

## ❌ Error: "Failed to create billing portal session"

### 🔍 Common Causes & Solutions

---

## 1. ⚠️ **Stripe Customer Portal Not Activated** (Most Common)

**Problem**: Stripe Customer Portal needs to be activated in your Stripe Dashboard before it can be used.

**Solution**:

1. Go to **Stripe Dashboard**: https://dashboard.stripe.com/
2. Navigate to: **Settings → Billing → Customer portal**
3. Click **"Activate test link"** (for test mode) or **"Activate link"** (for live mode)
4. Configure portal settings:
   - Allow customers to update payment methods
   - Allow customers to view invoices
   - Allow customers to cancel subscriptions (optional)
5. Click **"Save"**

**Important**: Portal must be activated separately for **Test Mode** and **Live Mode**.

---

## 2. 🔑 **Stripe Customer ID Missing or Invalid**

**Problem**: User doesn't have a valid `stripe_customer_id` in the database.

**Check**:
- User must complete a checkout process first
- `stripe_customer_id` should be saved in `users` table after checkout

**Solution**:
- Ensure checkout webhook is working correctly
- Verify `stripe_customer_id` is being saved after successful checkout

---

## 3. 🔐 **Stripe API Key Issues**

**Problem**: Wrong API key or key not configured.

**Check**:
```bash
# Backend .env file should have:
STRIPE_SECRET_KEY=sk_test_... (or sk_live_...)
```

**Solution**:
- Verify `STRIPE_SECRET_KEY` is set correctly
- Ensure you're using **Test Mode** keys for development
- Ensure you're using **Live Mode** keys for production
- Keys must match the mode (test/live) of your Stripe account

---

## 4. 🚫 **Customer Doesn't Exist in Stripe**

**Problem**: The `stripe_customer_id` in database doesn't exist in Stripe.

**Solution**:
- Customer might have been deleted in Stripe
- User needs to complete checkout again to create new customer

---

## 5. 🌐 **Frontend URL Configuration**

**Problem**: `FRONTEND_URL` environment variable might be incorrect.

**Check Backend**:
```bash
FRONTEND_URL=https://your-domain.com
```

**Solution**:
- Ensure `FRONTEND_URL` matches your actual frontend domain
- Should be the full URL (with https://)

---

## 📋 Quick Checklist

- [ ] Stripe Customer Portal activated in Dashboard (Test + Live)
- [ ] `STRIPE_SECRET_KEY` is set in backend `.env`
- [ ] User has `stripe_customer_id` in database
- [ ] Customer exists in Stripe Dashboard
- [ ] `FRONTEND_URL` is correctly configured
- [ ] Using correct API keys (test vs live)

---

## 🧪 Testing Steps

1. **Check Backend Logs**:
   ```bash
   # Look for these logs:
   ❌ Error creating customer portal session: ...
   ```

2. **Check Stripe Dashboard**:
   - Go to Customers → Find your customer
   - Verify customer exists and is not deleted

3. **Test Portal Directly**:
   - Stripe Dashboard → Settings → Billing → Customer portal
   - Click "Test link" to verify portal works

---

## 💡 Most Likely Fix

**90% of the time**, the issue is that **Stripe Customer Portal is not activated** in the Stripe Dashboard.

**Quick Fix**:
1. Login to Stripe Dashboard
2. Go to: Settings → Billing → Customer portal
3. Click "Activate test link" (for development)
4. Save settings
5. Try again

---

## 🔗 Useful Links

- [Stripe Customer Portal Setup](https://stripe.com/docs/billing/subscriptions/integrating-customer-portal)
- [Stripe Dashboard - Customer Portal](https://dashboard.stripe.com/settings/billing/portal)
