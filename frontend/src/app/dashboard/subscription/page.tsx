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
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
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
        console.log('📊 Subscription data fetched:', data)
        setSubscription(data)
      } else if (error) {
        console.error('❌ Error fetching subscription:', error)
      }
    } catch (error) {
      console.error('Error fetching subscription:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchSubscription()
    
    // Poll for updates every 10 seconds
    const interval = setInterval(fetchSubscription, 10000)
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

  const handleCancel = async () => {
    if (!user?.id || !subscription?.stripe_subscription_id) {
      setError('No active subscription to cancel')
      return
    }

    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your current billing period.')) {
      return
    }

    setCancelling(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await apiCall(API_ENDPOINTS.cancelSubscription, {
        method: 'POST',
        body: JSON.stringify({
          subscription_id: subscription.stripe_subscription_id
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to cancel subscription' }))
        throw new Error(errorData.error || 'Failed to cancel subscription')
      }

      setSuccess('Subscription cancelled successfully. You will retain access until the end of your billing period.')
      
      // Refresh subscription data
      setTimeout(() => {
        fetchSubscription()
      }, 2000)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to cancel subscription'
      setError(errorMessage)
    } finally {
      setCancelling(false)
    }
  }

  const handleManageBilling = async () => {
    if (!user?.id || !subscription?.stripe_customer_id) {
      setError('No active subscription found')
      return
    }

    setLoadingPortal(true)
    setError(null)

    try {
      const response = await apiCall(API_ENDPOINTS.customerPortal, {
        method: 'POST',
        body: JSON.stringify({
          customer_id: subscription.stripe_customer_id
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create billing portal session' }))
        throw new Error(errorData.error || 'Failed to create billing portal session')
      }

      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error('No portal URL received')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to open billing portal'
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Subscription & Plans</h1>
          <p className="text-gray-600 mt-2">Manage your subscription and upgrade your plan</p>
        </div>
        {/* Debug info - remove in production */}
        {subscription && (
          <div className="text-xs text-gray-500 mr-4">
            Status: {subscription.subscription_status} | Customer ID: {subscription.stripe_customer_id ? 'Yes' : 'No'}
          </div>
        )}
        {/* Show button for active, trialing, cancelled, trial, or any status with stripe_customer_id */}
        {subscription?.stripe_customer_id && (
          subscription?.subscription_status === 'active' || 
          subscription?.subscription_status === 'trialing' || 
          subscription?.subscription_status === 'cancelled' ||
          subscription?.subscription_status === 'trial'
        ) ? (
          <button
            onClick={handleManageBilling}
            disabled={loadingPortal}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors shadow-sm"
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            {loadingPortal ? 'Loading...' : 'Manage Billing'}
          </button>
        ) : null}
      </div>

      {/* Current Plan */}
      <div className={`rounded-lg shadow-sm border p-6 ${
        subscription?.subscription_status === 'expired' 
          ? 'bg-red-50 border-red-200' 
          : 'bg-white border-gray-200'
      }`}>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Current Plan</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold text-gray-900">
              {subscription?.subscription_status === 'expired' ? 'Trial Expired' :
               subscription?.subscription_plan === 'free' || subscription?.subscription_status === 'trial' ? 'Free Trial' : 
               subscription?.subscription_plan === 'starter' ? 'Starter Plan' :
               subscription?.subscription_plan === 'professional' ? 'Professional Plan' : 'Free'}
            </p>
            <p className="text-gray-600 mt-1">
              {subscription?.subscription_status === 'expired' 
                ? 'Your trial has expired. Upgrade to continue using WhatsApp Integration.'
                : `${subscription?.max_subaccounts} subaccount${subscription?.max_subaccounts !== 1 ? 's' : ''} allowed`}
            </p>
            {subscription?.subscription_status === 'expired' && subscription?.trial_ends_at && (
              <p className="text-sm text-red-600 mt-2 font-medium">
                ⚠️ Trial expired on {new Date(subscription.trial_ends_at).toLocaleDateString()}
              </p>
            )}
            {subscription?.subscription_status === 'trial' && subscription?.trial_ends_at && (
              <p className="text-sm text-orange-600 mt-2">
                Trial ends on {new Date(subscription.trial_ends_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium ${
              subscription?.subscription_status === 'expired' 
                ? 'bg-red-100 text-red-800' 
                : subscription?.subscription_status === 'active' 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-yellow-100 text-yellow-800'
            }`}>
              {subscription?.subscription_status === 'expired' 
                ? 'Expired' 
                : subscription?.subscription_status === 'active' 
                  ? 'Active' 
                  : 'Trial'}
            </div>
          </div>
        </div>
        {subscription?.subscription_status === 'expired' && (
          <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-lg">
            <p className="text-sm text-red-800 font-medium mb-2">
              ⚠️ Your trial has expired. Your subaccounts have been temporarily disabled.
            </p>
            <p className="text-sm text-red-700">
              Upgrade to a paid plan now to restore access to all your subaccounts and features.
            </p>
          </div>
        )}
        
        {/* Subscription Details */}
        {subscription && (subscription.subscription_status === 'active' || subscription.subscription_status === 'cancelled') && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Subscription Details</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {subscription.subscription_started_at && (
                <div>
                  <dt className="text-gray-600">Started</dt>
                  <dd className="font-medium text-gray-900">{formatDate(subscription.subscription_started_at)}</dd>
                </div>
              )}
              {subscription.subscription_ends_at && (
                <div>
                  <dt className="text-gray-600">
                    {subscription.subscription_status === 'cancelled' ? 'Access Until' : 'Renews On'}
                  </dt>
                  <dd className="font-medium text-gray-900">{formatDate(subscription.subscription_ends_at)}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Error/Success Messages */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        {/* Manage Subscription Options */}
        {subscription?.subscription_status === 'active' && subscription.stripe_subscription_id && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800 font-medium mb-2">
                💡 <strong>Manage Your Subscription:</strong>
              </p>
              <p className="text-sm text-blue-700">
                Use the &quot;Manage Billing&quot; button above to access Stripe Customer Portal where you can update payment methods, view invoices, cancel subscription, and more.
              </p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800">
                <strong>Note:</strong> Cancelling your subscription will stop automatic renewals. 
                You will retain full access until the end of your current billing period.
              </p>
            </div>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
            >
              {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
            </button>
          </div>
        )}
      </div>

      {/* Available Plans */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.name} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
              </div>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">${plan.price}</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start">
                    <svg className="w-5 h-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-700 text-sm">{feature}</span>
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
                  subscription?.subscription_plan === plan.name.toLowerCase() || 
                  plan.name === 'Free Trial' ||
                  upgrading === plan.planKey
                }
                className={`w-full py-2 px-4 rounded-lg transition-colors ${
                  subscription?.subscription_status === 'expired' && plan.name !== 'Free Trial'
                    ? 'bg-red-600 hover:bg-red-700 text-white font-semibold'
                    : subscription?.subscription_plan === plan.name.toLowerCase() || plan.name === 'Free Trial'
                      ? 'bg-gray-400 cursor-not-allowed text-white'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                } disabled:bg-gray-400 disabled:cursor-not-allowed`}
              >
                {upgrading === plan.planKey 
                  ? 'Loading...' 
                  : subscription?.subscription_plan === plan.name.toLowerCase() 
                    ? 'Current Plan' 
                    : plan.name === 'Free Trial'
                      ? subscription?.subscription_status === 'expired' ? 'Expired' : 'Current Plan'
                      : subscription?.subscription_status === 'expired' 
                        ? 'Upgrade to Restore Access'
                        : 'Upgrade'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

