'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { apiCall, API_ENDPOINTS } from '@/lib/config'

interface SubaccountSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  ghlAccountId: string
  locationId: string
}

interface Settings {
  create_contact_in_ghl: boolean
  drip_mode_enabled: boolean
  drip_messages_per_batch: number
  drip_delay_minutes: number
}

interface Analytics {
  total_messages_sent: number
  total_messages_received: number
  last_message_sent_at: string | null
  last_message_received_at: string | null
  last_activity_at: string | null
}

interface Session {
  id: string
  phone_number: string | null
  phone_number_display: string | null
  status: string
  is_active: boolean
  created_at: string
}

export default function SubaccountSettingsModal({
  isOpen,
  onClose,
  ghlAccountId,
  locationId
}: SubaccountSettingsModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<Settings>({
    create_contact_in_ghl: true,
    drip_mode_enabled: false,
    drip_messages_per_batch: 20,
    drip_delay_minutes: 5
  })
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch settings
      const settingsRes = await apiCall(API_ENDPOINTS.getSubaccountSettings(ghlAccountId))
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        setSettings(settingsData.settings)
      }

      // Fetch analytics
      const analyticsRes = await apiCall(API_ENDPOINTS.getSubaccountAnalytics(ghlAccountId))
      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json()
        setAnalytics(analyticsData.analytics)
      }

      // Fetch sessions
      const sessionsRes = await apiCall(API_ENDPOINTS.getSubaccountSessions(ghlAccountId))
      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json()
        setSessions(sessionsData.sessions || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
      setNotification({ type: 'error', message: 'Failed to load settings' })
    } finally {
      setLoading(false)
    }
  }, [ghlAccountId])

  useEffect(() => {
    if (isOpen && ghlAccountId) {
      fetchData()
    }
  }, [isOpen, ghlAccountId, fetchData])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiCall(API_ENDPOINTS.updateSubaccountSettings(ghlAccountId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })

      if (res.ok) {
        setNotification({ type: 'success', message: 'Settings saved successfully!' })
        setTimeout(() => {
          setNotification(null)
        }, 3000)
      } else {
        const error = await res.json()
        setNotification({ type: 'error', message: error.error || 'Failed to save settings' })
      }
    } catch (error) {
      console.error('Error saving settings:', error)
      setNotification({ type: 'error', message: 'Failed to save settings' })
    } finally {
      setSaving(false)
    }
  }

  const handleActivateSession = async (sessionId: string) => {
    try {
      const res = await apiCall(API_ENDPOINTS.activateSession(ghlAccountId, sessionId), {
        method: 'POST'
      })

      if (res.ok) {
        setNotification({ type: 'success', message: 'Session activated successfully!' })
        await fetchData() // Refresh sessions
        setTimeout(() => {
          setNotification(null)
        }, 3000)
      } else {
        const error = await res.json()
        setNotification({ type: 'error', message: error.error || 'Failed to activate session' })
      }
    } catch (error) {
      console.error('Error activating session:', error)
      setNotification({ type: 'error', message: 'Failed to activate session' })
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
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white border border-gray-200 text-left align-middle shadow-2xl transition-all">
                <div className="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <Dialog.Title as="h3" className="text-2xl font-bold text-gray-900">
                        Subaccount Settings
                      </Dialog.Title>
                      <p className="text-sm text-gray-500 mt-1">Location: {locationId}</p>
                    </div>
                    <button
                      onClick={onClose}
                      className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 transition-all"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="px-8 py-6 max-h-[70vh] overflow-y-auto">
      <div className="space-y-6">
        {notification && (
          <div className={`p-4 rounded-xl border ${
            notification.type === 'success' 
              ? 'bg-green-50 text-green-800 border-green-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <div className="flex items-center">
              {notification.type === 'success' ? (
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <span className="font-medium">{notification.message}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading settings...</p>
          </div>
        ) : (
          <>
            {/* Contact Creation Toggle */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Contact Management</h3>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="text-sm font-semibold text-gray-900 block mb-2">
                    Create Contact in GHL
                  </label>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    When enabled, new contacts are automatically created in GHL when they send WhatsApp messages.
                    When disabled, messages are only synced if the contact already exists.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-6 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.create_contact_in_ghl}
                    onChange={(e) => setSettings({ ...settings, create_contact_in_ghl: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            {/* Drip Mode Settings */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Drip Mode</h3>
              
              <div className="space-y-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-semibold text-gray-900 block mb-2">
                      Enable Drip Mode
                    </label>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Queue outbound messages and send them in batches with delays to avoid rate limits.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-6 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={settings.drip_mode_enabled}
                      onChange={(e) => setSettings({ ...settings, drip_mode_enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {settings.drip_mode_enabled && (
                  <div className="bg-white rounded-xl p-5 border border-gray-200 space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-2">
                        Messages per Batch
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={settings.drip_messages_per_batch}
                        onChange={(e) => setSettings({ ...settings, drip_messages_per_batch: parseInt(e.target.value) || 20 })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                      />
                      <p className="text-xs text-gray-500 mt-2">Number of messages to send in each batch (1-1000)</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-2">
                        Delay Between Batches (minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="1440"
                        value={settings.drip_delay_minutes}
                        onChange={(e) => setSettings({ ...settings, drip_delay_minutes: parseInt(e.target.value) || 5 })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                      />
                      <p className="text-xs text-gray-500 mt-2">Minutes to wait before sending the next batch (0-1440)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Analytics */}
            {analytics && (
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Analytics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <p className="text-xs font-medium text-gray-500 mb-1">Messages Sent</p>
                    <p className="text-3xl font-bold text-purple-600">{analytics.total_messages_sent || 0}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <p className="text-xs font-medium text-gray-500 mb-1">Messages Received</p>
                    <p className="text-3xl font-bold text-emerald-600">{analytics.total_messages_received || 0}</p>
                  </div>
                  {analytics.last_activity_at && (
                    <div className="col-span-2 mt-2 text-sm text-gray-600 bg-white/50 px-3 py-2 rounded-lg">
                      <span className="font-medium">Last Activity:</span> {new Date(analytics.last_activity_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Multi-Number Management */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Connected Numbers</h3>
              {sessions.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                          session.is_active
                            ? 'bg-green-50 border-green-300 shadow-sm'
                            : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <p className="text-sm font-semibold text-gray-900">
                              {session.phone_number_display || session.phone_number || 'No number'}
                            </p>
                            {session.is_active && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            Status: <span className="font-medium">{session.status}</span>
                          </p>
                        </div>
                        {!session.is_active && session.status === 'ready' && (
                          <button
                            onClick={() => handleActivateSession(session.id)}
                            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-sm hover:shadow-md"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-4 bg-white/50 px-3 py-2 rounded-lg border border-gray-200">
                    Only one number can be active at a time. Activating a number will deactivate others.
                  </p>
                </>
              ) : (
                <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
                  <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <p className="text-sm font-medium text-gray-600">No WhatsApp numbers connected yet.</p>
                  <p className="text-xs text-gray-500 mt-1">Create a session to connect a number.</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200">
              <button
                onClick={onClose}
                className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
              >
                {saving ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </span>
                ) : 'Save Settings'}
              </button>
            </div>
          </>
        )}
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
