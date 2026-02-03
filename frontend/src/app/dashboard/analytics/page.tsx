'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

interface PlanInfo {
  status: string
  maxSubaccounts: number
  totalSubaccounts: number
  trialEndsAt?: string
}

export default function AnalyticsPage() {
  const { user } = useAuth()
  const [plan, setPlan] = useState<PlanInfo | null>(null)
  const [counts, setCounts] = useState<{ total: number; inbound: number; outbound: number }>({ total: 0, inbound: 0, outbound: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return
      try {
        // Fetch user subscription info
        const { data: userRow } = await supabase
          .from('users')
          .select('subscription_status, max_subaccounts, total_subaccounts, trial_ends_at')
          .eq('id', user.id)
          .maybeSingle()

        if (userRow) {
          setPlan({
            status: userRow.subscription_status || 'trial',
            maxSubaccounts: userRow.max_subaccounts || 1,
            totalSubaccounts: userRow.total_subaccounts || 0,
            trialEndsAt: userRow.trial_ends_at || undefined,
          })
        }

        // Get all sessions for this user
        const { data: sessions } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', user.id)

        const sessionIds = (sessions || []).map(s => s.id)
        if (sessionIds.length === 0) {
          setCounts({ total: 0, inbound: 0, outbound: 0 })
          return
        }

        // Count outbound
        const { count: outbound } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .in('session_id', sessionIds)
          .eq('direction', 'out')

        const { count: inbound } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .in('session_id', sessionIds)
          .eq('direction', 'in')

        setCounts({ total: (outbound || 0) + (inbound || 0), inbound: inbound || 0, outbound: outbound || 0 })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user?.id])

  const statusBadge = useMemo(() => {
    if (!plan) return null
    const color = plan.status === 'professional' ? 'bg-emerald-100 text-emerald-700' : plan.status === 'starter' ? 'bg-indigo-100 text-indigo-700' : 'bg-yellow-100 text-yellow-700'
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{plan.status}</span>
  }, [plan])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-600 mt-1">Plan usage and messaging statistics</p>
      </div>

      {/* Stats Grid - Modern Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Current Plan */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-indigo-300 hover:shadow-lg transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            {statusBadge}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Current Plan</p>
            <p className="text-2xl font-bold text-gray-900">
              {plan ? plan.status.charAt(0).toUpperCase() + plan.status.slice(1) : '—'}
            </p>
            {plan && (
              <p className="text-xs text-gray-500 mt-2">
                {plan.totalSubaccounts}/{plan.maxSubaccounts} subaccounts
                {plan.trialEndsAt && (
                  <span className="block mt-1">Trial ends {new Date(plan.trialEndsAt).toLocaleDateString()}</span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Messages Sent */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Messages Sent</p>
            <p className="text-4xl font-bold text-purple-600">{counts.outbound.toLocaleString()}</p>
          </div>
        </div>

        {/* Messages Received */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-emerald-300 hover:shadow-lg transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 13l5 5m0 0l5-5m-5 5V6" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Messages Received</p>
            <p className="text-4xl font-bold text-emerald-600">{counts.inbound.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Total Messages - Large Card */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-8 border border-indigo-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-indigo-700 mb-2">Total Messages</p>
            <p className="text-5xl font-bold text-indigo-900">{counts.total.toLocaleString()}</p>
          </div>
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-gray-600">Loading analytics…</p>
          </div>
        </div>
      )}
    </div>
  )
}


