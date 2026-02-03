# 📱 Multi-Number Management Guide

## 🎯 कहाँ मिलेगा Multi-Number Settings?

### Location: Dashboard → Settings Button

**Step-by-Step:**

1. **Dashboard पर जाएं** (`/dashboard`)
2. **GHL Accounts table में** हर subaccount के row में **Settings button** (⚙️ icon) होगा
3. **Settings button click करें** → `SubaccountSettingsModal` खुलेगा
4. Modal में **"Connected Numbers"** section में सभी connected WhatsApp numbers दिखेंगे

---

## 📍 Exact Location

### Dashboard Table
```
Dashboard → GHL Accounts Table → Actions Column → ⚙️ Settings Button
```

**Visual:**
```
┌─────────────────────────────────────────────────┐
│ GHL Accounts                                    │
├─────────────────────────────────────────────────┤
│ Name    │ Status │ Date      │ Actions          │
├─────────────────────────────────────────────────┤
│ Account1│ Ready  │ 2024-01-01│ ⚙️ 🔲 🔄 ❌     │
│         │        │           │ ↑                │
│         │        │           │ Settings Button  │
└─────────────────────────────────────────────────┘
```

---

## 🔧 Settings Modal में क्या मिलेगा?

### SubaccountSettingsModal में 4 sections:

1. **Contact Management**
   - Create Contact in GHL toggle

2. **Drip Mode**
   - Enable Drip Mode toggle
   - Messages per batch
   - Delay between batches

3. **Analytics**
   - Total messages sent/received
   - Last activity

4. **Connected Numbers** ⭐ (Multi-Number Management)
   - सभी connected WhatsApp numbers की list
   - Active/Inactive status
   - Activate button (inactive numbers के लिए)

---

## 📱 Multi-Number Management Features

### Connected Numbers Section में:

#### Display:
- ✅ **Phone Number** (display format)
- ✅ **Status** (ready, qr, disconnected, etc.)
- ✅ **Active Badge** (green background if active)

#### Actions:
- ✅ **Activate Button** - Inactive numbers के लिए
- ✅ **Auto-Deactivate** - जब नया number activate हो, पुराना automatically deactivate हो जाता है

### Example UI:
```
┌─────────────────────────────────────────┐
│ Connected Numbers                       │
├─────────────────────────────────────────┤
│ +1234567890                             │
│ Status: ready • Active                  │
│ [Green Background]                      │
├─────────────────────────────────────────┤
│ +9876543210                             │
│ Status: ready                           │
│ [Gray Background] [Activate Button]     │
└─────────────────────────────────────────┘
```

---

## 🎮 कैसे Use करें?

### Step 1: Multiple Numbers Connect करें
1. Same subaccount के लिए **multiple QR codes scan** करें
2. हर number अलग session बनाएगा
3. सभी sessions `sessions` table में store होंगे

### Step 2: Active Number Set करें
1. Dashboard → Settings button (⚙️) click करें
2. Modal में **"Connected Numbers"** section देखें
3. जो number **inactive** है, उसके लिए **"Activate"** button click करें
4. पुराना active number automatically deactivate हो जाएगा

### Step 3: Verify
- Active number **green background** में दिखेगा
- Status में **"• Active"** badge दिखेगा
- Messages इसी active number से send/receive होंगे

---

## ⚙️ Backend Logic

### Auto-Activation:
- जब नया session **ready** status में आता है
- अगर यह subaccount का **पहला active session** है
- तो automatically `is_active = TRUE` set हो जाता है

### Manual Activation:
- User Settings modal से **Activate** button click करता है
- Backend endpoint: `POST /admin/subaccount/:ghlAccountId/sessions/:sessionId/activate`
- पुराना active session automatically deactivate हो जाता है
- नया session activate हो जाता है

### Message Routing:
- **Outbound messages**: सिर्फ `is_active = TRUE` वाला session use होता है
- **Inbound messages**: सभी sessions receive कर सकते हैं, लेकिन routing active session से होता है

---

## 🔍 Code Locations

### Frontend:
- **Settings Button**: `frontend/src/app/dashboard/page.tsx` (line 814-823)
- **Settings Modal**: `frontend/src/components/dashboard/SubaccountSettingsModal.tsx`
- **Multi-Number Section**: Lines 311-348

### Backend:
- **Activate Endpoint**: `backend/server.js` (line 2276)
- **Auto-Activation**: `backend/lib/baileys-wa.js` (session ready होने पर)

---

## ✅ Summary

**Multi-Number Settings कहाँ है:**
- ✅ Dashboard → GHL Accounts Table → ⚙️ Settings Button
- ✅ Settings Modal → "Connected Numbers" Section
- ✅ Inactive numbers के लिए "Activate" Button

**Features:**
- ✅ Multiple numbers connect कर सकते हैं
- ✅ एक समय में सिर्फ एक active
- ✅ Settings modal से activate/deactivate
- ✅ Auto-deactivation when new number activated

---

**Last Updated**: 2024
**Status**: ✅ Fully Implemented
