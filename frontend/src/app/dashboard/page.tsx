'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PaymentRenewalModal from '@/components/dashboard/PaymentRenewalModal'
import { useToast } from '@/components/ui/ToastProvider'

export default function Dashboard() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const toast = useToast()
  const [stats, setStats] = useState({
    totalAccounts: 0,
    activeConnections: 0,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    activeRate: 0
  })
  const [loading, setLoading] = useState(true)
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  const fetchDashboardStats = useCallback(async () => {
    if (!user?.id) return

    try {
      // Fetch GHL accounts
      const { data: ghlAccounts } = await supabase
        .from('ghl_accounts')
        .select('id')
        .eq('user_id', user.id)

      const totalAccounts = ghlAccounts?.length || 0

      // Fetch sessions to count active connections
      const accountIds = ghlAccounts?.map(acc => acc.id) || []
      let activeConnections = 0
      
      if (accountIds.length > 0) {
        const { data: sessions } = await supabase
          .from('sessions')
          .select('id')
          .in('subaccount_id', accountIds)
          .eq('status', 'ready')
        
        activeConnections = sessions?.length || 0
      }

      // Fetch total messages from analytics
      let totalSent = 0
      let totalReceived = 0

      if (accountIds.length > 0) {
        const { data: analytics } = await supabase
          .from('subaccount_analytics')
          .select('total_messages_sent, total_messages_received')
          .in('ghl_account_id', accountIds)

        if (analytics) {
          totalSent = analytics.reduce((sum, a) => sum + (a.total_messages_sent || 0), 0)
          totalReceived = analytics.reduce((sum, a) => sum + (a.total_messages_received || 0), 0)
        }
      }

      setStats({
        totalAccounts,
        activeConnections,
        totalMessagesSent: totalSent,
        totalMessagesReceived: totalReceived,
        activeRate: totalAccounts > 0 ? Math.round((activeConnections / totalAccounts) * 100) : 0
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchDashboardStats()
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardStats, 30000)
    return () => clearInterval(interval)
  }, [fetchDashboardStats])

  // Fetch subscription status
  useEffect(() => {
    const fetchSubscriptionStatus = async () => {
      if (!user?.id) return
      
      try {
        const { data, error } = await supabase
          .from('users')
          .select('subscription_status')
          .eq('id', user.id)
          .single()

        if (!error && data) {
          setSubscriptionStatus(data.subscription_status)
        }
      } catch (error) {
        console.error('Error fetching subscription status:', error)
      }
    }

    fetchSubscriptionStatus()
  }, [user])

  // Check for success/error messages in URL
  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')
    const current = searchParams.get('current')
    const max = searchParams.get('max')
    
    // Account-related toasts
    if (success === 'account_added') {
      toast.showToast({
        type: 'success',
        title: 'Account Connected',
        message: 'Your GoHighLevel account has been connected successfully!',
        durationMs: 5000
      })
      router.replace('/dashboard')
    } else if (error === 'account_already_added') {
      toast.showToast({
        type: 'warning',
        title: 'Account Already Connected',
        message: 'This account is already connected to your profile.',
        durationMs: 5000
      })
      router.replace('/dashboard')
    } else if (error === 'location_exists') {
      toast.showToast({
        type: 'error',
        title: 'Location Already In Use',
        message: 'This location is already linked to another account. Please use a different GoHighLevel location.',
        durationMs: 6000
      })
      router.replace('/dashboard')
    } else if (error === 'limit_reached') {
      toast.showToast({
        type: 'error',
        title: 'Account Limit Reached',
        message: `You have reached your account limit (${current || 0}/${max || 0}). Please upgrade your plan to add more accounts.`,
        durationMs: 6000
      })
      router.replace('/dashboard')
    } 
    // Subscription/Payment related toasts
    else if (error === 'payment_failed') {
      toast.showToast({
        type: 'error',
        title: 'Payment Failed',
        message: 'Payment failed. Please update your payment method to continue using the service.',
        durationMs: 6000
      })
      router.replace('/dashboard')
    } else if (error === 'subscription_expired') {
      toast.showToast({
        type: 'warning',
        title: 'Subscription Expired',
        message: 'Your subscription has expired. Please upgrade to continue.',
        durationMs: 6000
      })
      router.replace('/dashboard')
    }
  }, [searchParams, router, toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  const isPaymentRequired = subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled'

  return (
    <div className="space-y-8">
      {/* Payment Renewal Modal */}
      {isPaymentRequired && (
        <PaymentRenewalModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          subscriptionStatus={subscriptionStatus === 'past_due' ? 'past_due' : 'cancelled'}
        />
      )}
      
      {/* Header - Modern Compact */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
        <p className="text-sm text-gray-500">Overview of your WhatsApp Business integration</p>
      </div>

      {/* Stats Grid - Modern Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Total Subaccounts */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-5 border border-gray-200/50 hover:border-indigo-300/50 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-100 to-indigo-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Subaccounts</p>
            <p className="text-3xl font-bold text-gray-900">{stats.totalAccounts}</p>
          </div>
        </div>

        {/* Active Connections */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-5 border border-gray-200/50 hover:border-green-300/50 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-100 to-green-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Active Connections</p>
            <p className="text-3xl font-bold text-green-600">{stats.activeConnections}</p>
            <p className="text-xs text-green-600 mt-1.5 flex items-center">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse"></span>
              {stats.activeRate}% uptime
            </p>
          </div>
        </div>

        {/* Messages Sent */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-5 border border-gray-200/50 hover:border-purple-300/50 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-purple-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Messages Sent</p>
            <p className="text-3xl font-bold text-purple-600">{stats.totalMessagesSent.toLocaleString()}</p>
          </div>
        </div>

        {/* Messages Received */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-5 border border-gray-200/50 hover:border-blue-300/50 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-blue-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Messages Received</p>
            <p className="text-3xl font-bold text-blue-600">{stats.totalMessagesReceived.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions - Modern Style */}
      <div className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-gray-200/50 mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Link
            href="/dashboard/accounts"
            className="group p-5 bg-gradient-to-br from-gray-50/80 to-white/80 backdrop-blur-sm border border-gray-200/50 hover:border-indigo-300/50 rounded-lg transition-all duration-200 hover:shadow-md"
          >
            <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center mb-3 group-hover:bg-indigo-600 transition-colors">
              <svg className="w-4.5 h-4.5 text-indigo-600 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Manage Accounts</h3>
            <p className="text-xs text-gray-500">View and configure your GHL integrations</p>
          </Link>

          <button
            onClick={() => {
              if (subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired') {
                if (subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled') {
                  setShowPaymentModal(true)
                } else {
                  router.push('/dashboard/subscription')
                }
              } else {
                window.location.href = '/dashboard/add-subaccount'
              }
            }}
            disabled={subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired'}
            className="group p-5 bg-gradient-to-br from-gray-50/80 to-white/80 backdrop-blur-sm border border-gray-200/50 hover:border-green-300/50 rounded-lg transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-left w-full"
            title={
              subscriptionStatus === 'expired' 
                ? 'Your subscription has expired. Please upgrade to add accounts.'
                : subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled'
                ? 'Payment required to add new accounts'
                : ''
            }
          >
            <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center mb-3 group-hover:bg-green-600 transition-colors">
              <svg className="w-4.5 h-4.5 text-green-600 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Add Subaccount</h3>
            <p className="text-xs text-gray-500">Connect a new GHL location</p>
          </button>

          <Link
            href="/dashboard/subscription"
            className="group p-5 bg-gradient-to-br from-gray-50/80 to-white/80 backdrop-blur-sm border border-gray-200/50 hover:border-blue-300/50 rounded-lg transition-all duration-200 hover:shadow-md"
          >
            <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center mb-3 group-hover:bg-blue-600 transition-colors">
              <svg className="w-4.5 h-4.5 text-blue-600 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Subscription</h3>
            <p className="text-xs text-gray-500">Manage your plan and billing</p>
          </Link>
        </div>
      </div>

      {/* Activity Overview - Modern Design */}
      <div className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-gray-200/50">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Activity Overview</h2>
            <p className="text-xs text-gray-500 mt-0.5">Real-time connection status</p>
          </div>
          <Link
            href="/dashboard/accounts"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            View all →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Connection Status */}
          <div>
            <div className="flex items-baseline space-x-2 mb-4">
              <p className="text-6xl font-bold text-gray-900">{stats.activeRate}%</p>
              <p className="text-sm text-gray-500">uptime</p>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-500"
                  style={{ width: `${stats.activeRate}%` }}
                ></div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">{stats.activeConnections} of {stats.totalAccounts} accounts active</p>
          </div>

          {/* Message Stats */}
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-700">Sent</span>
              </div>
              <span className="text-2xl font-bold text-gray-900">{stats.totalMessagesSent.toLocaleString()}</span>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 13l5 5m0 0l5-5m-5 5V6" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-700">Received</span>
              </div>
              <span className="text-2xl font-bold text-gray-900">{stats.totalMessagesReceived.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Getting Started - If no accounts */}
      {stats.totalAccounts === 0 && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-12 border border-indigo-100 text-center">
          <div className="max-w-2xl mx-auto">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Octendr</h3>
            <p className="text-gray-600 mb-8">
              Connect your GoHighLevel account with WhatsApp to start automating conversations
            </p>
            <Link
              href="/dashboard/add-subaccount"
              className="inline-flex items-center px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Connect Your First Account
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
