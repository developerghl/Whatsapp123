'use client'

import { useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js'
import { useAuth } from '@/hooks/useAuth'
import { API_ENDPOINTS } from '@/lib/config'

// Publishable key — safe for client, never the secret key
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
)

interface CheckoutFormProps {
  plan: 'starter' | 'professional'
  onClose: () => void
}

export default function CheckoutForm({ plan, onClose }: CheckoutFormProps) {
  const { user } = useAuth()

  // Called automatically by EmbeddedCheckoutProvider on mount
  const fetchClientSecret = useCallback(async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (user?.id) {
      headers['X-User-ID'] = user.id
    }

    const res = await fetch(API_ENDPOINTS.createCheckout, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ plan }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create checkout session')
    }

    if (!data.clientSecret) {
      throw new Error('No client secret received from server')
    }

    return data.clientSecret
  }, [plan, user?.id])

  const planLabel = plan === 'professional' ? 'Professional Plan' : 'Starter Plan'
  const planPrice = plan === 'professional' ? '$49/month' : '$19/month'
  const planNote =
    plan === 'professional'
      ? '3-day free trial · Cancel anytime'
      : 'Billed immediately · Cancel anytime'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-bold text-[#1a1a1a]">{planLabel}</h3>
            <p className="text-xs text-[#737373] mt-0.5">
              {planPrice} · {planNote}
            </p>
          </div>
          <button
            id="checkout-close-btn"
            onClick={onClose}
            aria-label="Close checkout"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#a3a3a3] hover:bg-gray-100 hover:text-[#1a1a1a] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stripe Embedded Checkout — renders Stripe's card form inline */}
        <div id="checkout" className="p-2">
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{ fetchClientSecret }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  )
}
