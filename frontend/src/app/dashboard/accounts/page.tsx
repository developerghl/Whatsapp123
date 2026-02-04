'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { API_ENDPOINTS, apiCall } from '@/lib/config'
import SubaccountSettingsModal from '@/components/dashboard/SubaccountSettingsModal'
import PaymentRenewalModal from '@/components/dashboard/PaymentRenewalModal'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/ToastProvider'
import { useSearchParams, useRouter } from 'next/navigation'

interface SubaccountStatus {
  id: string
  name: string
  ghl_location_id: string
  status: 'initializing' | 'qr' | 'ready' | 'disconnected' | 'none'
  phone_number?: string
  qr?: string
  created_at?: string
  total_messages_sent?: number
  total_messages_received?: number
  last_activity_at?: string
}

export default function AccountsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [subaccountStatuses, setSubaccountStatuses] = useState<SubaccountStatus[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; locationId?: string }>({ open: false })
  const [confirmResetSession, setConfirmResetSession] = useState<{ open: boolean; locationId?: string }>({ open: false })
  const [settingsModal, setSettingsModal] = useState<{ open: boolean; ghlAccountId?: string; locationId?: string }>({ open: false })
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  // No URL param handling needed here - all account toasts show on dashboard page after redirect


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

  const fetchGHLLocations = useCallback(async (showLoading = true) => {
    try {
      if (!user) return
      
      if (showLoading) {
        setLoading(true)
      }

      const { data: ghlAccounts, error: ghlError } = await supabase
        .from('ghl_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (ghlError) {
        console.error('Database error:', ghlError)
      }

      if (ghlAccounts && ghlAccounts.length > 0) {
        const statusPromises = ghlAccounts.map(async (ghlAccount) => {
          if (ghlAccount.location_id) {
            try {
              const sessionResponse = await apiCall(API_ENDPOINTS.getSession(ghlAccount.location_id))
              let sessionData = { status: 'none', phone_number: null, qr: null }
              
              if (sessionResponse.ok) {
                sessionData = await sessionResponse.json()
              }

              // Fetch analytics
              let analytics = { total_messages_sent: 0, total_messages_received: 0, last_activity_at: null }
              try {
                const analyticsRes = await apiCall(API_ENDPOINTS.getSubaccountAnalytics(ghlAccount.id))
                if (analyticsRes.ok) {
                  const analyticsData = await analyticsRes.json()
                  analytics = analyticsData.analytics || analytics
                }
              } catch {
                // Silent fail
              }
              
              return {
                id: ghlAccount.id,
                name: `Location ${ghlAccount.location_id}`,
                ghl_location_id: ghlAccount.location_id,
                status: (sessionData.status as 'initializing' | 'qr' | 'ready' | 'disconnected' | 'none') || 'none',
                phone_number: sessionData.phone_number || undefined,
                qr: sessionData.qr || undefined,
                created_at: ghlAccount.created_at,
                total_messages_sent: analytics.total_messages_sent || 0,
                total_messages_received: analytics.total_messages_received || 0,
                last_activity_at: analytics.last_activity_at || undefined
              }
            } catch (error) {
              console.error('Error fetching session status:', error)
              return {
                id: ghlAccount.id,
                name: `Location ${ghlAccount.location_id}`,
                ghl_location_id: ghlAccount.location_id,
                status: 'none' as const,
                created_at: ghlAccount.created_at
              }
            }
          }
          return null
        })
        
        const statuses = (await Promise.all(statusPromises)).filter(Boolean) as SubaccountStatus[]
        setSubaccountStatuses(statuses)
      } else {
        setSubaccountStatuses([])
      }
    } catch (error) {
      console.error('Error fetching GHL locations:', error)
      setSubaccountStatuses([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user])

  useEffect(() => {
    fetchGHLLocations()
  }, [fetchGHLLocations])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchGHLLocations(false)
  }

  const openQR = async (locationId: string) => {
    try {
      const createResponse = await apiCall(API_ENDPOINTS.createSession(locationId), {
        method: 'POST',
        body: JSON.stringify({ locationId })
      })

      if (createResponse.ok) {
        await fetchGHLLocations(false)
        const link = API_ENDPOINTS.providerUI(locationId)
        window.open(link, '_blank')
      } else {
        const errorData = await createResponse.json()
        toast.showToast({
          type: 'error',
          title: 'Session Creation Failed',
          message: errorData.error || 'Unknown error occurred'
        })
      }
    } catch (error) {
      console.error('Error creating session:', error)
      toast.showToast({
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create session'
      })
    }
  }

  const logoutSession = async (locationId: string) => {
    try {
      const response = await apiCall(API_ENDPOINTS.logoutSession(locationId), {
        method: 'POST'
      })

      if (response.ok) {
        toast.showToast({
          type: 'success',
          title: 'Session Logged Out',
          message: 'Session logged out successfully!'
        })
        await fetchGHLLocations(false)
      } else {
        toast.showToast({
          type: 'error',
          title: 'Logout Failed',
          message: 'Failed to logout session'
        })
      }
    } catch (error) {
      console.error('Error logging out session:', error)
      toast.showToast({
        type: 'error',
        title: 'Logout Failed',
        message: 'An error occurred while logging out the session'
      })
    }
  }

  const resetSession = (locationId: string) => {
    setConfirmResetSession({ open: true, locationId })
  }

  const confirmResetSessionAction = async () => {
    const locationId = confirmResetSession.locationId
    if (!locationId) return

    try {
      const response = await apiCall(API_ENDPOINTS.resetSession(locationId), {
        method: 'POST'
      })

      if (response.ok) {
        toast.showToast({
          type: 'success',
          title: 'Session Reset',
          message: 'Session reset successfully!'
        })
        setConfirmResetSession({ open: false })
        await fetchGHLLocations(false)
      } else {
        toast.showToast({
          type: 'error',
          title: 'Reset Failed',
          message: 'Failed to reset session'
        })
      }
    } catch (error) {
      console.error('Error resetting session:', error)
      toast.showToast({
        type: 'error',
        title: 'Reset Failed',
        message: 'An error occurred while resetting the session'
      })
    }
  }

  const deleteSubaccount = (locationId: string) => {
    setConfirmDelete({ open: true, locationId })
  }

  const confirmDeleteAction = async () => {
    const locationId = confirmDelete.locationId
    if (!locationId) return

    try {
      const response = await apiCall(API_ENDPOINTS.deleteSubaccount, {
        method: 'DELETE',
        body: JSON.stringify({ locationId })
      })

      if (response.ok) {
        toast.showToast({
          type: 'success',
          title: 'Account Deleted',
          message: 'Account deleted successfully!'
        })
        setConfirmDelete({ open: false })
        await fetchGHLLocations(false)
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete account' }))
        toast.showToast({
          type: 'error',
          title: 'Delete Failed',
          message: errorData.error || 'Failed to delete account'
        })
      }
    } catch (error) {
      console.error('Error deleting account:', error)
      toast.showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'An error occurred while deleting the account'
      })
    }
  }


  // Filter and search
  const filteredAccounts = subaccountStatuses.filter(account => {
    const matchesSearch = account.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         account.ghl_location_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         account.phone_number?.includes(searchQuery)
    
    const matchesStatus = filterStatus === 'all' || account.status === filterStatus
    
    return matchesSearch && matchesStatus
  })

  // Pagination
  const totalPages = Math.ceil(filteredAccounts.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentAccounts = filteredAccounts.slice(startIndex, endIndex)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, filterStatus])

  const getStatusBadge = (status: string) => {
    const badges = {
      ready: { color: 'bg-green-50 text-green-700 border border-green-200', icon: '●', text: 'Connected' },
      qr: { color: 'bg-amber-50 text-amber-700 border border-amber-200', icon: '◐', text: 'Pending QR' },
      initializing: { color: 'bg-blue-50 text-blue-700 border border-blue-200', icon: '◌', text: 'Initializing' },
      disconnected: { color: 'bg-red-50 text-red-700 border border-red-200', icon: '○', text: 'Disconnected' },
      none: { color: 'bg-gray-50 text-gray-700 border border-gray-200', icon: '○', text: 'Not Connected' }
    }
    return badges[status as keyof typeof badges] || badges.none
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading accounts...</p>
        </div>
      </div>
    )
  }

  const isPaymentRequired = subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled'

  return (
    <div className="space-y-6">
      {/* Payment Renewal Modal */}
      {isPaymentRequired && (
        <PaymentRenewalModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          subscriptionStatus={subscriptionStatus === 'past_due' ? 'past_due' : 'cancelled'}
        />
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">GHL Accounts</h1>
          <p className="text-gray-600 mt-1">Manage your GoHighLevel WhatsApp integrations</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
          >
            <span className={refreshing ? 'animate-spin inline-block mr-2' : 'mr-2'}>↻</span>
            Refresh
          </button>
          <button
            onClick={() => {
              if (subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired') {
                if (subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled') {
                  setShowPaymentModal(true)
                } else {
                  window.location.href = '/dashboard/subscription'
                }
              } else {
                window.location.href = '/dashboard/add-subaccount'
              }
            }}
            disabled={subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired'}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              subscriptionStatus === 'expired' 
                ? 'Your subscription has expired. Please upgrade to add accounts.'
                : subscriptionStatus === 'past_due' || subscriptionStatus === 'cancelled'
                ? 'Payment required to add new accounts'
                : ''
            }
          >
            + Add Account
          </button>
        </div>
      </div>

      {/* Filters and Search - Minimal Style */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="Search by location ID or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <svg className="absolute left-3 top-3 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="ready">Connected</option>
            <option value="qr">Pending QR</option>
            <option value="initializing">Initializing</option>
            <option value="disconnected">Disconnected</option>
            <option value="none">Not Connected</option>
          </select>
        </div>
      </div>

      {/* Accounts Table - Clean Minimal Design */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {currentAccounts.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Location</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Phone Number</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Messages</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Last Activity</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentAccounts.map((account) => {
                    const statusBadge = getStatusBadge(account.status)
                    return (
                      <tr key={account.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{account.ghl_location_id}</p>
                              <p className="text-xs text-gray-500">GHL Location</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {account.phone_number ? (
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-sm font-medium text-gray-900">{account.phone_number}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">Not connected</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${statusBadge.color}`}>
                            <span className="mr-1.5">{statusBadge.icon}</span>
                            {statusBadge.text}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3 text-sm">
                            <div className="text-center">
                              <p className="font-bold text-indigo-600">{account.total_messages_sent || 0}</p>
                              <p className="text-xs text-gray-500">Sent</p>
                            </div>
                            <span className="text-gray-300">|</span>
                            <div className="text-center">
                              <p className="font-bold text-blue-600">{account.total_messages_received || 0}</p>
                              <p className="text-xs text-gray-500">Received</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {account.last_activity_at 
                            ? new Date(account.last_activity_at).toLocaleString('en-US', { 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : account.created_at 
                              ? new Date(account.created_at).toLocaleDateString()
                              : 'N/A'
                          }
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setSettingsModal({ open: true, ghlAccountId: account.id, locationId: account.ghl_location_id })}
                              className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Settings"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => openQR(account.ghl_location_id)}
                              className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                            >
                              QR Code
                            </button>
                            {account.status === 'ready' && (
                              <button
                                onClick={() => logoutSession(account.ghl_location_id)}
                                className="p-2 text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                title="Logout"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => resetSession(account.ghl_location_id)}
                              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Reset"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => deleteSubaccount(account.ghl_location_id)}
                              className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    Showing {startIndex + 1}-{Math.min(endIndex, filteredAccounts.length)} of {filteredAccounts.length}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            currentPage === page
                              ? 'bg-indigo-600 text-white'
                              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-6 py-16 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No accounts found</h3>
            <p className="text-gray-500 mb-6">
              {searchQuery || filterStatus !== 'all'
                ? 'Try adjusting your search or filter'
                : 'Get started by adding your first account'}
            </p>
            {!searchQuery && filterStatus === 'all' && (
              <button
                onClick={() => window.location.href = '/dashboard/add-subaccount'}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
              >
                + Add Account
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {confirmDelete.open && (
        <Modal
          isOpen={confirmDelete.open}
          onClose={() => setConfirmDelete({ open: false })}
          title="Delete Account?"
          icon="danger"
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={confirmDeleteAction}
        >
          <p>This will remove the account and disconnect WhatsApp.</p>
        </Modal>
      )}

      {confirmResetSession.open && (
        <Modal
          isOpen={confirmResetSession.open}
          onClose={() => setConfirmResetSession({ open: false })}
          title="Reset Session?"
          icon="warning"
          confirmText="Reset"
          cancelText="Cancel"
          onConfirm={confirmResetSessionAction}
        >
          <p>This will disconnect WhatsApp and require QR scan again.</p>
        </Modal>
      )}

      {settingsModal.open && settingsModal.ghlAccountId && settingsModal.locationId && (
        <SubaccountSettingsModal
          isOpen={settingsModal.open}
          onClose={() => setSettingsModal({ open: false })}
          ghlAccountId={settingsModal.ghlAccountId}
          locationId={settingsModal.locationId}
        />
      )}

    </div>
  )
}
