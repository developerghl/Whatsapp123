'use client'

import { useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { API_ENDPOINTS, apiCall } from '@/lib/config'

interface PaymentRenewalModalProps {
  isOpen: boolean
  onClose: () => void
  subscriptionStatus: 'past_due' | 'cancelled'
}

export default function PaymentRenewalModal({
  isOpen,
  onClose,
  subscriptionStatus
}: PaymentRenewalModalProps) {
  const [loading, setLoading] = useState(false)

  const handleOpenStripePortal = async () => {
    setLoading(true)
    try {
      const response = await apiCall(API_ENDPOINTS.customerPortal, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.url) {
          // Redirect to Stripe Customer Portal
          window.location.href = data.url
        } else {
          alert('Failed to get billing portal URL')
        }
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to open billing portal')
      }
    } catch (error) {
      console.error('Error opening Stripe portal:', error)
      alert('Failed to open billing portal')
    } finally {
      setLoading(false)
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white border border-gray-200 text-left align-middle shadow-2xl transition-all">
                <div className="p-8">
                  <div className="flex items-start">
                    <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-xl bg-orange-100 shadow-sm">
                      <svg className="h-6 w-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="ml-4 text-left flex-1">
                      <Dialog.Title as="h3" className="text-lg font-bold text-gray-900">
                        {subscriptionStatus === 'past_due' ? 'Payment Required' : 'Subscription Cancelled'}
                      </Dialog.Title>
                      <div className="mt-3 text-sm text-gray-600 leading-relaxed">
                        {subscriptionStatus === 'past_due' ? (
                          <>
                            <p className="mb-3">
                              Your subscription payment has failed. To continue using WhatsApp integration, please update your payment method and pay the pending invoice.
                            </p>
                            <p className="mb-3">
                              <strong>Note:</strong> Your existing accounts remain, but WhatsApp connections have been temporarily disabled until payment is completed.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="mb-3">
                              Your subscription has been cancelled. To reactivate your subscription and restore WhatsApp connections, please renew your subscription.
                            </p>
                            <p className="mb-3">
                              <strong>Note:</strong> Your existing accounts remain, but WhatsApp connections are disabled.
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="ml-3 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      aria-label="Close"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="mt-8 flex justify-end space-x-3">
                    <button
                      type="button"
                      disabled={loading}
                      className="inline-flex justify-center rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200"
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      className="inline-flex justify-center items-center rounded-xl border border-transparent px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                      onClick={handleOpenStripePortal}
                    >
                      {loading && (
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {loading ? 'Opening...' : subscriptionStatus === 'past_due' ? 'Pay Invoice' : 'Renew Subscription'}
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
