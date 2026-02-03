'use client'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useEffect, useState, useCallback } from 'react'
import { API_ENDPOINTS, apiCall } from '@/lib/config'

interface SubscriptionData {
  subscription_status: string
  subscription_plan: string
  max_subaccounts: number
  trial_ends_at?: string
  subscription_started_at?: string
  subscription_ends_at?: string
  stripe_subscription_id?: string
  stripe_customer_id?: string
}

export default function SubscriptionPage() {
  const { user } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingPortal, setLoadingPortal] = useState(false)

  const fetchSubscription = useCallback(async () => {
    if (!user?.id) return

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('users')
        .select('subscription_status, subscription_plan, max_subaccounts, trial_ends_at, subscription_started_at, subscription_ends_at, stripe_subscription_id, stripe_customer_id')
        .eq('id', user.id)
        .single()

      if (!error && data) {
        setSubscription(data)
      }
    } catch (error) {
      console.error('Error fetching subscription:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    // Sync with Stripe on load (silent background sync)
    const syncWithStripe = async () => {
      try {
        await apiCall(API_ENDPOINTS.syncSubscription, { method: 'POST' })
      } catch (error) {
        console.error('Error syncing subscription:', error)
      }
    }
    
    syncWithStripe()
    fetchSubscription()
    
    // Poll for updates every 10 seconds (silent background sync)
    const interval = setInterval(() => {
      syncWithStripe()
      fetchSubscription()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchSubscription])

  const plans = [
    { name: 'Free Trial', price: 0, subaccounts: 1, features: ['7 days free', '1 subaccount', 'Unlimited WhatsApp Messages'], planKey: null },
    { name: 'Starter', price: 19, subaccounts: 2, features: ['2 subaccounts', 'Unlimited WhatsApp Messages', 'Priority support'], planKey: 'starter' as const },
    { name: 'Professional', price: 49, subaccounts: 10, features: ['10 subaccounts', 'Unlimited WhatsApp Messages', 'API access', 'Advanced analytics'], planKey: 'professional' as const },
  ]

  const handleUpgrade = async (plan: 'starter' | 'professional') => {
    if (!user?.id) {
      alert('Please login to upgrade')
      return
    }

    setUpgrading(plan)

    try {
      const checkoutUrl = API_ENDPOINTS.createCheckout

      // Add user ID header for authentication (cross-domain cookie support)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add X-User-ID header for backend authentication
      if (user?.id) {
        headers['X-User-ID'] = user.id;
      }

      const response = await fetch(checkoutUrl, {
        method: 'POST',
        headers,
        credentials: 'include', // Include cookies if available
        body: JSON.stringify({
          plan,
          userEmail: user.email
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || 'Failed to create checkout session')
      }

      const data = await response.json()
      const { url } = data

      if (url) {
        window.location.href = url
      } else {
        throw new Error('No checkout URL received')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start checkout. Please try again.'
      alert(`Error: ${errorMessage}`)
      setUpgrading(null)
    }
  }


  const handleManageBilling = async () => {
    if (!user?.id) {
      setError('Please login to continue.')
      return
    }

    setLoadingPortal(true)
    setError(null)

    try {
      const response = await apiCall(API_ENDPOINTS.customerPortal, {
        method: 'POST',
        body: JSON.stringify({})
      })

      if (!response.ok) {
        let errorData
        try {
          errorData = await response.json()
        } catch {
          errorData = { error: 'Failed to create billing portal session' }
        }
        
        // Show user-friendly error message with details
        let errorMessage = errorData.error || 'Failed to open billing portal'
        
        // Add helpful details if available
        if (errorData.details) {
          if (errorData.details.includes('Customer Portal') || errorData.details.includes('billing portal')) {
            errorMessage = 'Billing portal is not configured. Please contact support.'
          } else if (errorData.details.includes('customer not found') || errorData.details.includes('does not exist')) {
            errorMessage = 'Your account is not linked to a billing account. Please complete a subscription purchase first.'
          } else {
            errorMessage = errorData.error || 'Unable to open billing portal'
          }
        }
        
        throw new Error(errorMessage)
      }

      const data = await response.json()
      
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error('Unable to open billing portal. Please try again later.')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to open billing portal. Please try again later.'
      setError(errorMessage)
    } finally {
      setLoadingPortal(false)
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header - Modern */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Subscription</h1>
          <p className="text-gray-600 mt-1">Manage your plan and billing</p>
        </div>
        {subscription?.stripe_customer_id && (
          subscription?.subscription_status === 'active' || 
          subscription?.subscription_status === 'trialing' || 
          subscription?.subscription_status === 'cancelled' ||
          subscription?.subscription_status === 'trial'
        ) ? (
          <button
            onClick={handleManageBilling}
            disabled={loadingPortal}
            className="inline-flex items-center px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
          >
            {loadingPortal ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Manage Billing
              </>
            )}
          </button>
        ) : null}
      </div>

      {/* Current Plan - Modern Card */}
      <div className={`rounded-2xl p-8 border transition-all ${
        subscription?.subscription_status === 'expired' 
          ? 'bg-gradient-to-br from-red-50 to-orange-50 border-red-200' 
          : subscription?.subscription_status === 'past_due'
            ? 'bg-gradient-to-br from-orange-50 to-yellow-50 border-orange-200'
          : 'bg-white border-gray-200 hover:shadow-lg'
      }`}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Current Plan</h2>
          <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${
            subscription?.subscription_status === 'expired' 
              ? 'bg-red-100 text-red-800' 
              : subscription?.subscription_status === 'past_due'
                ? 'bg-orange-100 text-orange-800'
              : subscription?.subscription_status === 'active' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-yellow-100 text-yellow-800'
          }`}>
            {subscription?.subscription_status === 'expired' 
              ? 'Expired' 
              : subscription?.subscription_status === 'past_due'
                ? 'Payment Failed'
              : subscription?.subscription_status === 'active' 
                ? 'Active' 
                : 'Trial'}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-4xl font-bold text-gray-900 mb-2">
              {subscription?.subscription_status === 'expired' ? 'Trial Expired' :
               subscription?.subscription_plan === 'free' || subscription?.subscription_status === 'trial' ? 'Free Trial' : 
               subscription?.subscription_plan === 'starter' ? 'Starter Plan' :
               subscription?.subscription_plan === 'professional' ? 'Professional Plan' : 'Free'}
            </p>
            <p className="text-gray-600 text-lg">
              {subscription?.subscription_status === 'expired' 
                ? 'Your trial has expired. Upgrade to continue using WhatsApp Integration.'
                : `${subscription?.max_subaccounts} subaccount${subscription?.max_subaccounts !== 1 ? 's' : ''} allowed`}
            </p>
            {subscription?.subscription_status === 'expired' && subscription?.trial_ends_at && (
              <div className="mt-3 inline-flex items-center px-3 py-1.5 bg-red-100 rounded-lg">
                <svg className="w-4 h-4 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-red-800 font-medium">
                  Trial expired on {new Date(subscription.trial_ends_at).toLocaleDateString()}
                </span>
              </div>
            )}
            {subscription?.subscription_status === 'trial' && subscription?.trial_ends_at && (
              <div className="mt-3 inline-flex items-center px-3 py-1.5 bg-orange-100 rounded-lg">
                <svg className="w-4 h-4 text-orange-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-orange-800 font-medium">
                  Trial ends on {new Date(subscription.trial_ends_at).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Payment Failed Warning */}
        {subscription?.subscription_status === 'past_due' && (
          <div className="mt-6 p-6 bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-300 rounded-xl">
            <div className="flex items-start">
              <div className="flex-shrink-0 w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center mr-4">
                <svg className="w-6 h-6 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-orange-900 mb-2">Payment Required</h3>
                <p className="text-sm text-orange-800 mb-4">
                  Your subscription payment has failed. Please pay your pending invoice to restore access to all services.
                </p>
                <p className="text-sm text-orange-700 mb-4 font-medium">
                  ⚠️ Your existing accounts remain, but WhatsApp connections are disabled until payment is completed.
                </p>
                <button
                  onClick={handleManageBilling}
                  disabled={loadingPortal}
                  className="inline-flex items-center px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
                >
                  {loadingPortal ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      Pay Invoice Now
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Subscription Cancelled Warning */}
        {subscription?.subscription_status === 'cancelled' && (
          <div className="mt-6 p-6 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-xl">
            <div className="flex items-start">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mr-4">
                <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-900 mb-2">Subscription Cancelled</h3>
                <p className="text-sm text-red-800 mb-4">
                  Your subscription has been cancelled. Please renew your subscription to restore access to all services.
                </p>
                <p className="text-sm text-red-700 mb-4 font-medium">
                  ⚠️ Your existing accounts remain, but WhatsApp connections are disabled until subscription is renewed.
                </p>
                <button
                  onClick={handleManageBilling}
                  disabled={loadingPortal}
                  className="inline-flex items-center px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
                >
                  {loadingPortal ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Renew Subscription
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {subscription?.subscription_status === 'expired' && (
          <div className="mt-6 p-5 bg-red-100 border border-red-300 rounded-xl">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm text-red-900 font-semibold mb-1">
                  Your trial has expired. Your subaccounts have been temporarily disabled.
                </p>
                <p className="text-sm text-red-800">
                  Upgrade to a paid plan now to restore access to all your subaccounts and features.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Subscription Details */}
        {subscription && (subscription.subscription_status === 'active' || subscription.subscription_status === 'cancelled' || subscription.subscription_status === 'past_due') && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Subscription Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subscription.subscription_started_at && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Started</dt>
                  <dd className="text-base font-semibold text-gray-900">{formatDate(subscription.subscription_started_at)}</dd>
                </div>
              )}
              {subscription.subscription_ends_at && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    {subscription.subscription_status === 'cancelled' ? 'Access Until' : 'Renews On'}
                  </dt>
                  <dd className="text-base font-semibold text-gray-900">{formatDate(subscription.subscription_ends_at)}</dd>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Messages */}
        {error && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-red-800 font-medium">{error}</p>
            </div>
          </div>
        )}

        {/* Manage Subscription Info */}
        {subscription?.subscription_status === 'active' && subscription.stripe_customer_id && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-5">
              <div className="flex items-start">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-indigo-900 mb-2">
                    Manage Your Subscription
                  </p>
                  <p className="text-sm text-indigo-800 mb-3">
                    Use the &quot;Manage Billing&quot; button above to access your billing portal where you can:
                  </p>
                  <ul className="text-sm text-indigo-800 space-y-1.5">
                    <li className="flex items-center">
                      <svg className="w-4 h-4 mr-2 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Update payment methods
                    </li>
                    <li className="flex items-center">
                      <svg className="w-4 h-4 mr-2 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      View and download invoices
                    </li>
                    <li className="flex items-center">
                      <svg className="w-4 h-4 mr-2 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Update billing information
                    </li>
                    <li className="flex items-center">
                      <svg className="w-4 h-4 mr-2 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Cancel your subscription
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Available Plans - Modern Design */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-6">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan, index) => {
            const isCurrentPlan = subscription?.subscription_plan === plan.name.toLowerCase() || (plan.name === 'Free Trial' && (subscription?.subscription_plan === 'free' || subscription?.subscription_status === 'trial'))
            const isProfessional = plan.name === 'Professional'
            
            return (
              <div 
                key={plan.name} 
                className={`relative bg-white rounded-2xl border-2 p-8 transition-all duration-300 ${
                  isCurrentPlan 
                    ? 'border-indigo-400 shadow-xl scale-105' 
                    : isProfessional
                      ? 'border-indigo-200 hover:border-indigo-400 hover:shadow-xl'
                      : 'border-gray-200 hover:border-indigo-300 hover:shadow-lg'
                }`}
              >
                {isCurrentPlan && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-indigo-600 text-white px-4 py-1 rounded-full text-xs font-semibold shadow-lg">
                      Current Plan
                    </span>
                  </div>
                )}
                
                {isProfessional && !isCurrentPlan && (
                  <div className="absolute -top-3 right-4">
                    <span className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-md">
                      Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                  <div className="flex items-baseline">
                    <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
                    <span className="text-gray-600 ml-2">/month</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start">
                      <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-0.5 flex-shrink-0">
                        <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span className="text-gray-700 text-sm leading-relaxed">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button 
                  onClick={() => {
                    if (plan.planKey && plan.name !== 'Free Trial') {
                      handleUpgrade(plan.planKey as 'starter' | 'professional')
                    }
                  }}
                  disabled={
                    isCurrentPlan || 
                    plan.name === 'Free Trial' ||
                    (upgrading !== null && upgrading === plan.planKey)
                  }
                  className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 ${
                    subscription?.subscription_status === 'expired' && plan.name !== 'Free Trial'
                      ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl'
                      : isCurrentPlan
                        ? 'bg-gray-300 cursor-not-allowed text-gray-600'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg hover:shadow-xl'
                  } disabled:bg-gray-300 disabled:cursor-not-allowed disabled:shadow-none`}
                >
                  {/* Free Trial - Never show loading */}
                  {plan.name === 'Free Trial' ? (
                    subscription?.subscription_status === 'expired' ? 'Expired' : 'Current Plan'
                  ) : (
                    /* Other plans - Check loading state only if planKey matches */
                    upgrading !== null && upgrading === plan.planKey ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </span>
                    ) : isCurrentPlan ? (
                      'Current Plan'
                    ) : subscription?.subscription_status === 'expired' || subscription?.subscription_status === 'past_due' ? (
                      'Upgrade to Restore Access'
                    ) : (
                      'Upgrade'
                    )
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

