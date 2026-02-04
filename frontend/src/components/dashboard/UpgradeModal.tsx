'use client'

import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { useAuth } from '@/hooks/useAuth'
import { API_ENDPOINTS } from '@/lib/config'
import { useToast } from '@/components/ui/ToastProvider'

interface UpgradeModalProps {
  isOpen: boolean
  onClose: () => void
  currentPlan: string
  currentSubaccounts: number
  maxSubaccounts: number
  showAdditionalSubaccount?: boolean
}

export default function UpgradeModal({
  isOpen,
  onClose,
  currentPlan,
  currentSubaccounts,
  maxSubaccounts,
  showAdditionalSubaccount = false
}: UpgradeModalProps) {
  const { user } = useAuth()
  const toast = useToast()
  const [loading, setLoading] = useState<string | null>(null)

  const handleAdditionalSubaccount = async () => {
    if (!user?.id) {
      toast.showToast({
        type: 'error',
        title: 'Login Required',
        message: 'Please login to purchase additional subaccount'
      })
      return
    }

    setLoading('additional')

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (user?.id) {
        headers['X-User-ID'] = user.id;
      }

      const response = await fetch(`${API_ENDPOINTS.createCheckout}?additional_subaccount=true`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          additional_subaccount: true,
          userEmail: user.email
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create checkout session')
      }

      const { url } = await response.json()

      if (url) {
        window.location.href = url
      } else {
        throw new Error('No checkout URL received')
      }
    } catch (error) {
      console.error('Error purchasing additional subaccount:', error)
      toast.showToast({
        type: 'error',
        title: 'Checkout Failed',
        message: error instanceof Error ? error.message : 'Failed to start checkout. Please try again.'
      })
      setLoading(null)
    }
  }

  const handleUpgrade = async (plan: 'starter' | 'professional') => {
    if (!user?.id) {
      toast.showToast({
        type: 'error',
        title: 'Login Required',
        message: 'Please login to upgrade'
      })
      return
    }

    setLoading(plan)

    try {
      // Add user ID header for authentication (cross-domain cookie support)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add X-User-ID header for backend authentication
      if (user?.id) {
        headers['X-User-ID'] = user.id;
      }

      const response = await fetch(API_ENDPOINTS.createCheckout, {
        method: 'POST',
        headers,
        credentials: 'include', // Include cookies if available
        body: JSON.stringify({
          plan,
          userEmail: user.email
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create checkout session')
      }

      const { url } = await response.json()

      if (url) {
        // Redirect to Stripe Checkout
        window.location.href = url
      } else {
        throw new Error('No checkout URL received')
      }
    } catch (error) {
      console.error('Error creating checkout:', error)
      toast.showToast({
        type: 'error',
        title: 'Checkout Failed',
        message: error instanceof Error ? error.message : 'Failed to start checkout. Please try again.'
      })
      setLoading(null)
    }
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
          <div className="fixed inset-0 bg-gray-900 bg-opacity-40 backdrop-blur-[2px]" />
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
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all">
                {/* Header */}
                <div className="bg-gradient-to-r from-green-600 to-blue-600 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Dialog.Title as="h3" className="text-xl font-bold text-white">
                        ⚠️ Plan Limit Reached
                      </Dialog.Title>
                      <p className="text-green-100 text-sm mt-1">
                        Current plan: <span className="font-semibold">{currentPlan}</span> · Upgrade to add more subaccounts
                      </p>
                    </div>
                    <button
                      onClick={onClose}
                      className="text-white hover:text-gray-200 transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6">
                  <div className="mb-6 text-center">
                      <p className="text-gray-700 text-lg">
                        Your current plan allows <strong>{maxSubaccounts} subaccount{maxSubaccounts !== 1 ? 's' : ''}</strong>, and you&apos;re already using <strong>{currentSubaccounts}</strong>.
                      </p>
                    <p className="text-gray-600 text-sm mt-2">
                      {showAdditionalSubaccount 
                        ? 'Purchase an additional subaccount or upgrade to a higher plan:'
                        : 'Choose a plan to unlock more locations:'}
                    </p>
                  </div>

                  {/* Additional Subaccount Option (Professional Plan Only) */}
                  {showAdditionalSubaccount && (
                    <div className="mb-6 border-2 border-indigo-500 rounded-xl p-6 bg-gradient-to-r from-indigo-50 to-purple-50">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="text-xl font-bold text-gray-900">Add Another Subaccount</h4>
                          <p className="text-gray-600 text-sm mt-1">One-time payment for additional subaccount (Professional Plan only)</p>
                        </div>
                        <span className="px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-semibold rounded-full">
                          Professional Only
                        </span>
                      </div>
                      <div className="mb-4">
                        <span className="text-3xl font-bold text-gray-900">$4</span>
                        <span className="text-gray-600"> one-time</span>
                      </div>
                      <ul className="space-y-2 mb-6">
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">+1 additional subaccount</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">Unlimited WhatsApp Messages</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">All current plan features</span>
                        </li>
                      </ul>
                      <button
                        onClick={handleAdditionalSubaccount}
                        disabled={loading === 'additional'}
                        className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all"
                      >
                        {loading === 'additional' ? 'Loading...' : 'Add Subaccount for $4'}
                      </button>
                    </div>
                  )}

                  {/* Plans */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Starter Plan */}
                    <div className="border-2 border-gray-200 rounded-xl p-6 hover:border-green-500 transition-colors">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xl font-bold text-gray-900">Starter Plan</h4>
                        <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                          Popular
                        </span>
                      </div>
                      <div className="mb-4">
                        <span className="text-3xl font-bold text-gray-900">$19</span>
                        <span className="text-gray-600">/month</span>
                      </div>
                      <ul className="space-y-2 mb-6">
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">2 subaccounts</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">Unlimited WhatsApp Messages</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">Priority email support</span>
                        </li>
                      </ul>
                      <button
                        onClick={() => handleUpgrade('starter')}
                        disabled={loading === 'starter'}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                      >
                        {loading === 'starter' ? 'Loading...' : 'Upgrade to Starter'}
                      </button>
                    </div>

                    {/* Professional Plan */}
                    <div className="border-2 border-blue-500 rounded-xl p-6 hover:shadow-lg transition-all">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xl font-bold text-gray-900">Professional Plan</h4>
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                          Best Value
                        </span>
                      </div>
                      <div className="mb-4">
                        <span className="text-3xl font-bold text-gray-900">$49</span>
                        <span className="text-gray-600">/month</span>
                      </div>
                      <ul className="space-y-2 mb-6">
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">10 subaccounts</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">Unlimited WhatsApp Messages</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">Priority support + phone support</span>
                        </li>
                        <li className="flex items-start">
                          <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">API access</span>
                        </li>
                      </ul>
                      <button
                        onClick={() => handleUpgrade('professional')}
                        disabled={loading === 'professional'}
                        className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all"
                      >
                        {loading === 'professional' ? 'Loading...' : 'Upgrade to Professional'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 text-center">
                    <button
                      onClick={onClose}
                      className="text-gray-600 hover:text-gray-800 text-sm underline"
                    >
                      Maybe later
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

