'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiCall, API_ENDPOINTS } from '@/lib/config'
import PaymentRenewalModal from '@/components/dashboard/PaymentRenewalModal'
import { useToast } from '@/components/ui/ToastProvider'

export default function AddSubAccount() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<{
    status: string
    trialEndsAt?: string
    subscriptionEndsAt?: string
  } | null>(null)
  const [subscriptionInfo, setSubscriptionInfo] = useState<{
    subscription_status: string
    max_subaccounts: number
    current_subaccounts: number
    trial_ends_at?: string
    previously_owned_locations: string[]
    can_add_new: boolean
    limit_reached: boolean
  } | null>(null)
  const [checking, setChecking] = useState(true)
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  // Check subscription status and limits - FAST CHECK FIRST
  useEffect(() => {
    const checkSubscription = async () => {
      if (!user?.id) {
        setChecking(false)
        return
      }

      try {
        // FAST CHECK: Direct DB query first (immediate)
        const { data: quickData, error: quickError } = await supabase
          .from('users')
          .select('subscription_status, trial_ends_at, subscription_ends_at')
          .eq('id', user.id)
          .single()

        if (!quickError && quickData) {
          // Set status immediately to block button
          setSubscriptionStatus({
            status: quickData.subscription_status || 'trial',
            trialEndsAt: quickData.trial_ends_at,
            subscriptionEndsAt: quickData.subscription_ends_at
          })
          setChecking(false) // Allow button interaction after quick check
        }

        // Then fetch full subscription info from backend (includes limits)
        try {
          const response = await apiCall(API_ENDPOINTS.subscriptionInfo)
          
          if (response.ok) {
            const data = await response.json()
            setSubscriptionInfo(data)
            // Update status if different
            if (data.subscription_status) {
              setSubscriptionStatus({
                status: data.subscription_status || 'trial',
                trialEndsAt: data.trial_ends_at,
                subscriptionEndsAt: data.subscription_ends_at
              })
            }
          }
        } catch (apiError) {
          console.error('Error fetching subscription info:', apiError)
          // Keep the quick check status
        }
      } catch (error) {
        console.error('Error checking subscription:', error)
        setChecking(false) // Allow interaction even on error
      }
    }

    checkSubscription()
  }, [user])

  // Check URL params for payment_failed and subscription_expired errors
  useEffect(() => {
    const error = searchParams.get('error')
    const status = searchParams.get('status')
    
    if (error === 'payment_failed' && (status === 'past_due' || status === 'cancelled')) {
      setShowPaymentModal(true)
      // Clear URL params
      router.replace('/dashboard/add-subaccount')
    } else if (error === 'subscription_expired') {
      toast.showToast({
        type: 'warning',
        title: 'Subscription Expired',
        message: 'Your subscription has expired. Please upgrade to add accounts.',
        durationMs: 5000
      })
      // Clear URL params
      router.replace('/dashboard/add-subaccount')
    }
  }, [searchParams, router, toast])

  // Helper to check if trial/subscription is expired
  const isExpired = (): boolean => {
    if (!subscriptionStatus) return false
    if (subscriptionStatus.status === 'expired') return true
    
    // Check if cancelled subscription has passed subscription_ends_at
    if (subscriptionStatus.status === 'cancelled' && subscriptionStatus.subscriptionEndsAt) {
      try {
        const endsAt = new Date(subscriptionStatus.subscriptionEndsAt)
        const now = new Date()
        if (endsAt <= now) {
          return true // Subscription period ended
        }
      } catch {
        // If date parsing fails, treat as expired if status is cancelled
        return true
      }
    }
    
    // Only check trial_ends_at if user is actually on trial/free plan
    // Active subscriptions (starter/professional) should NOT be blocked by old trial dates
    const isOnTrial = subscriptionStatus.status === 'trial' || subscriptionStatus.status === 'free'
    if (isOnTrial && subscriptionStatus.trialEndsAt) {
      try {
        return new Date(subscriptionStatus.trialEndsAt) <= new Date()
      } catch {
        return false
      }
    }
    return false
  }

  // Check if payment is required (past_due or cancelled)
  const isPaymentRequired = (): boolean => {
    if (!subscriptionStatus) return false
    return subscriptionStatus.status === 'past_due' || subscriptionStatus.status === 'cancelled'
  }

  const handleConnect = async () => {
    setLoading(true)

    try {
      // Check if user is logged in
      if (!user?.id) {
        toast.showToast({
          type: 'error',
          title: 'Login Required',
          message: 'Please login first to add your GHL account'
        })
        setLoading(false)
        return
      }

      // Check if payment is required (past_due or cancelled)
      if (isPaymentRequired()) {
        setShowPaymentModal(true)
        setLoading(false)
        return
      }

      // Check if trial/subscription is expired
      if (isExpired()) {
        toast.showToast({
          type: 'warning',
          title: 'Trial Expired',
          message: 'Your trial has expired. Please upgrade your subscription to add accounts.'
        })
        router.push('/dashboard/subscription')
        setLoading(false)
        return
      }

      // Check if subscription status is expired
      if (subscriptionStatus?.status === 'expired') {
        toast.showToast({
          type: 'warning',
          title: 'Subscription Expired',
          message: 'Your subscription has expired. Please upgrade to continue using WhatsApp Integration.'
        })
        router.push('/dashboard/subscription')
        setLoading(false)
        return
      }

      // Check if limit is reached and user can only re-add previously owned locations
      if (subscriptionInfo?.limit_reached && !subscriptionInfo.can_add_new) {
        const availableCount = subscriptionInfo.previously_owned_locations?.length || 0
        
        if (availableCount > 0) {
          toast.showToast({
            type: 'warning',
            title: 'Subaccount Limit Reached',
            message: `You've reached your limit (${subscriptionInfo.current_subaccounts}/${subscriptionInfo.max_subaccounts}). You can re-add one of your ${availableCount} previously owned location(s), or purchase an additional subaccount.`,
            durationMs: 6000
          })
        } else {
          if (subscriptionInfo.subscription_status === 'active') {
            toast.showToast({
              type: 'warning',
              title: 'Subaccount Limit Reached',
              message: `You've reached your limit (${subscriptionInfo.current_subaccounts}/${subscriptionInfo.max_subaccounts}). Purchase an additional subaccount for $4 (Professional Plan only).`,
              durationMs: 6000
            })
          } else {
            toast.showToast({
              type: 'warning',
              title: 'Trial Limit Reached',
              message: `You've reached your trial limit (${subscriptionInfo.current_subaccounts}/${subscriptionInfo.max_subaccounts}). Please upgrade your subscription.`
            })
            router.push('/dashboard/subscription')
          }
        }
        setLoading(false)
        return
      }

      // GHL OAuth configuration
      const GHL_CLIENT_ID = process.env.NEXT_PUBLIC_GHL_CLIENT_ID || 'YOUR_CLIENT_ID'
      const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.octendr.com'
      const REDIRECT_URI = `${BACKEND_URL}/oauth/callback`
      const SCOPES = 'locations.readonly conversations.write conversations.readonly conversations/message.readonly conversations/message.write contacts.readonly contacts.write businesses.readonly users.readonly medias.write'
      
      // Direct GHL OAuth URL with user ID in state parameter
      const ghlOAuthUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${GHL_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${encodeURIComponent(user.id)}`
      
      console.log('📍 Direct GHL OAuth redirect with user ID:', user.id)
      console.log('🔗 OAuth URL:', ghlOAuthUrl)
      
      // Direct redirect to GHL marketplace (NO backend HTTP call)
      window.location.href = ghlOAuthUrl
      
    } catch (error) {
      console.error('Error starting OAuth:', error)
      toast.showToast({
        type: 'error',
        title: 'Connection Failed',
        message: 'Failed to start OAuth connection. Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading...</p>
          <p className="text-sm text-gray-500 mt-2">Checking subscription status</p>
        </div>
      </div>
    )
  }

  const expired = isExpired()
  const paymentRequired = isPaymentRequired()

  return (
    <div className="space-y-8">
      {/* Payment Renewal Modal */}
      {subscriptionStatus && (subscriptionStatus.status === 'past_due' || subscriptionStatus.status === 'cancelled') && (
        <PaymentRenewalModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          subscriptionStatus={subscriptionStatus.status === 'past_due' ? 'past_due' : 'cancelled'}
        />
      )}
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Add Subaccount</h1>
        <p className="text-gray-600 mt-1">Connect your GoHighLevel location to start using WhatsApp</p>
      </div>

      {paymentRequired && (
        <div className="bg-gradient-to-r from-orange-50 to-red-50 rounded-2xl border border-orange-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-orange-900 mb-1">
                ⚠️ {subscriptionStatus?.status === 'past_due' ? 'Payment Required' : 'Subscription Cancelled'}
              </h3>
              <p className="text-sm text-orange-700">
                {subscriptionStatus?.status === 'past_due' 
                  ? 'Your subscription payment has failed. Please update your payment method to continue adding accounts.'
                  : 'Your subscription has been cancelled. Please renew to continue adding accounts.'}
              </p>
            </div>
            <button
              onClick={() => setShowPaymentModal(true)}
              className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-semibold rounded-xl text-white bg-orange-600 hover:bg-orange-700 transition-all shadow-sm hover:shadow-md"
            >
              {subscriptionStatus?.status === 'past_due' ? 'Pay Invoice' : 'Renew Subscription'}
            </button>
          </div>
        </div>
      )}
      
      {expired && !paymentRequired && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-2xl border border-red-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-red-900 mb-1">
                ⚠️ Your trial has expired
              </h3>
              <p className="text-sm text-red-700">
                Please upgrade your subscription to add accounts and continue using WhatsApp Integration.
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard/subscription')}
              className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-semibold rounded-xl text-white bg-red-600 hover:bg-red-700 transition-all shadow-sm hover:shadow-md"
            >
              Upgrade Now
            </button>
          </div>
        </div>
      )}
      
      {/* Connection Card - Modern Minimal */}
      <div className="bg-white rounded-2xl border border-gray-200 p-8 hover:shadow-lg transition-all duration-300">
        <div className="text-center max-w-lg mx-auto">
          {/* Icon */}
          <div className="flex items-center justify-center w-20 h-20 bg-indigo-100 rounded-2xl mx-auto mb-6 shadow-sm">
            <svg className="w-10 h-10 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Connect Location</h2>
          <p className="text-gray-600 mb-8">
            Connect your GoHighLevel location to enable WhatsApp integration
          </p>
          
          {/* Limit Warning */}
          {subscriptionInfo?.limit_reached && !subscriptionInfo.can_add_new && (
            <div className="mb-6 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border border-yellow-200 p-5">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <svg className="h-5 w-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <div className="ml-4 flex-1">
                  <h3 className="text-sm font-semibold text-yellow-900 mb-1">
                    Subaccount Limit Reached
                  </h3>
                  <div className="text-sm text-yellow-800">
                    <p className="mb-1">
                      You&apos;re currently using {subscriptionInfo.current_subaccounts} of {subscriptionInfo.max_subaccounts} subaccounts.
                    </p>
                    {subscriptionInfo.previously_owned_locations && subscriptionInfo.previously_owned_locations.length > 0 ? (
                      <p>
                        You can only re-add one of your {subscriptionInfo.previously_owned_locations.length} previously owned location(s), or purchase an additional subaccount for $4 (Professional Plan only).
                      </p>
                    ) : subscriptionInfo.subscription_status === 'active' ? (
                      <p>
                        Please go back to the dashboard to purchase an additional subaccount for $4 (Professional Plan only).
                      </p>
                    ) : (
                      <p>
                        Please upgrade your subscription to add more locations.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Features */}
          <div className="bg-indigo-50 rounded-xl p-6 mb-8 border border-indigo-100">
            <p className="text-sm font-semibold text-indigo-900 mb-3">✨ What you get:</p>
            <ul className="text-sm text-indigo-800 space-y-2 text-left">
              <li className="flex items-center">
                <svg className="w-5 h-5 text-indigo-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                WhatsApp QR code generation
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-indigo-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Send and receive messages
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-indigo-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Manage conversations
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-indigo-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Real-time message sync
              </li>
            </ul>
          </div>
          
          {/* Subaccount Count */}
          {subscriptionInfo && (
            <div className="mb-8 inline-flex items-center px-4 py-2 bg-gray-50 rounded-xl border border-gray-200">
              <span className="text-sm font-medium text-gray-700">Subaccounts:</span>
              <span className="ml-2 text-sm font-bold text-gray-900">{subscriptionInfo.current_subaccounts} / {subscriptionInfo.max_subaccounts}</span>
            </div>
          )}
          
          {/* Connect Button */}
          <button
            onClick={paymentRequired ? () => setShowPaymentModal(true) : handleConnect}
            disabled={checking || loading || expired || paymentRequired || (subscriptionInfo?.limit_reached && !subscriptionInfo.can_add_new)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 px-6 rounded-xl font-semibold text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
            title={
              checking
                ? 'Checking subscription status...'
                : paymentRequired
                ? 'Payment required. Please renew your subscription to add accounts.'
                : expired 
                ? 'Your trial has expired. Please upgrade to add accounts.'
                : subscriptionInfo?.limit_reached && !subscriptionInfo.can_add_new
                ? 'You have reached your subaccount limit. You can only re-add previously owned locations or purchase an additional subaccount.'
                : ''
            }
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </span>
            ) : checking ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Checking...
              </span>
            ) : (
              <span className="flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Connect Location
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}