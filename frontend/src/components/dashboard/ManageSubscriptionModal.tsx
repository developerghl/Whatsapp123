'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { API_ENDPOINTS, apiCall } from '@/lib/config'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'

interface SubscriptionDetails {
  subscription_status: string
  subscription_plan: string
  max_subaccounts: number
  subscription_started_at?: string
  subscription_ends_at?: string
  trial_ends_at?: string
  stripe_subscription_id?: string
  stripe_customer_id?: string
}

interface ManageSubscriptionModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function ManageSubscriptionModal({ isOpen, onClose }: ManageSubscriptionModalProps) {
  const { user } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Fetch subscription details
  const fetchSubscription = async () => {
    if (!user?.id) return

    try {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('subscription_status, subscription_plan, max_subaccounts, subscription_started_at, subscription_ends_at, trial_ends_at, stripe_subscription_id, stripe_customer_id')
        .eq('id', user.id)
        .single()

      if (!fetchError && data) {
        setSubscription(data)
      } else {
        setError('Failed to load subscription details')
      }
    } catch (err) {
      console.error('Error fetching subscription:', err)
      setError('Failed to load subscription details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && user) {
      fetchSubscription()
      // Poll for updates every 5 seconds when modal is open
      const interval = setInterval(fetchSubscription, 5000)
      return () => clearInterval(interval)
    }
  }, [isOpen, user])

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

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Active' },
      trial: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Trial' },
      cancelled: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Cancelled' },
      expired: { bg: 'bg-red-100', text: 'text-red-800', label: 'Expired' },
      past_due: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Past Due' }
    }

    const config = statusConfig[status as keyof typeof statusConfig] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status }
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    )
  }

  const getPlanName = (plan: string) => {
    const planNames: Record<string, string> = {
      free: 'Free Trial',
      starter: 'Starter Plan',
      professional: 'Professional Plan'
    }
    return planNames[plan] || plan
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title className="text-2xl font-bold text-gray-900">
                    Manage Subscription
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
                  </div>
                ) : subscription ? (
                  <div className="space-y-6">
                    {/* Current Plan Card */}
                    <div className="bg-gradient-to-br from-indigo-50 to-white rounded-xl p-6 border border-indigo-100">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">Current Plan</h3>
                          <p className="text-2xl font-bold text-indigo-600 mt-1">
                            {getPlanName(subscription.subscription_plan)}
                          </p>
                        </div>
                        {getStatusBadge(subscription.subscription_status)}
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <p className="text-sm text-gray-600">Max Subaccounts</p>
                          <p className="text-lg font-semibold text-gray-900">{subscription.max_subaccounts}</p>
                        </div>
                        {subscription.subscription_ends_at && (
                          <div>
                            <p className="text-sm text-gray-600">
                              {subscription.subscription_status === 'cancelled' ? 'Access Until' : 'Renews On'}
                            </p>
                            <p className="text-lg font-semibold text-gray-900">
                              {formatDate(subscription.subscription_ends_at)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Subscription Details */}
                    <div className="bg-gray-50 rounded-xl p-6">
                      <h4 className="font-semibold text-gray-900 mb-4">Subscription Details</h4>
                      <dl className="space-y-3">
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-600">Status</dt>
                          <dd className="text-sm font-medium text-gray-900">
                            {getStatusBadge(subscription.subscription_status)}
                          </dd>
                        </div>
                        {subscription.subscription_started_at && (
                          <div className="flex justify-between">
                            <dt className="text-sm text-gray-600">Started</dt>
                            <dd className="text-sm font-medium text-gray-900">
                              {formatDate(subscription.subscription_started_at)}
                            </dd>
                          </div>
                        )}
                        {subscription.trial_ends_at && subscription.subscription_status === 'trial' && (
                          <div className="flex justify-between">
                            <dt className="text-sm text-gray-600">Trial Ends</dt>
                            <dd className="text-sm font-medium text-gray-900">
                              {formatDate(subscription.trial_ends_at)}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    {/* Error/Success Messages */}
                    {error && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-800">{error}</p>
                      </div>
                    )}
                    {success && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <p className="text-sm text-green-800">{success}</p>
                      </div>
                    )}

                    {/* Cancel Subscription Button */}
                    {subscription.subscription_status === 'active' && subscription.stripe_subscription_id && (
                      <div className="border-t pt-6">
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

                    {/* View Plans Button */}
                    <div className="border-t pt-6">
                      <a
                        href="/dashboard/subscription"
                        className="block w-full text-center py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors"
                      >
                        View Available Plans
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-600">Failed to load subscription details</p>
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
