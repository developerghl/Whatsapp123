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
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <Dialog.Title as="h3" className="text-xl font-bold text-gray-900">
                      Subaccount Settings
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
                  <p className="text-sm text-gray-500 mt-1">Location: {locationId}</p>
                </div>
                <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
      <div className="space-y-6">
        {notification && (
          <div className={`p-3 rounded-lg ${
            notification.type === 'success' 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {notification.message}
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
            <div className="border-b border-gray-200 pb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Contact Management</h3>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-700">
                    Create Contact in GHL
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    When enabled, new contacts are automatically created in GHL when they send WhatsApp messages.
                    When disabled, messages are only synced if the contact already exists.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={settings.create_contact_in_ghl}
                    onChange={(e) => setSettings({ ...settings, create_contact_in_ghl: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            {/* Drip Mode Settings */}
            <div className="border-b border-gray-200 pb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Drip Mode</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700">
                      Enable Drip Mode
                    </label>
                    <p className="text-xs text-gray-500 mt-1">
                      Queue outbound messages and send them in batches with delays to avoid rate limits.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-4">
                    <input
                      type="checkbox"
                      checked={settings.drip_mode_enabled}
                      onChange={(e) => setSettings({ ...settings, drip_mode_enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {settings.drip_mode_enabled && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Messages per Batch
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={settings.drip_messages_per_batch}
                        onChange={(e) => setSettings({ ...settings, drip_messages_per_batch: parseInt(e.target.value) || 20 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">Number of messages to send in each batch (1-1000)</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Delay Between Batches (minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="1440"
                        value={settings.drip_delay_minutes}
                        onChange={(e) => setSettings({ ...settings, drip_delay_minutes: parseInt(e.target.value) || 5 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">Minutes to wait before sending the next batch (0-1440)</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Analytics */}
            {analytics && (
              <div className="border-b border-gray-200 pb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Analytics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-500">Messages Sent</p>
                    <p className="text-2xl font-bold text-gray-900">{analytics.total_messages_sent || 0}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-500">Messages Received</p>
                    <p className="text-2xl font-bold text-gray-900">{analytics.total_messages_received || 0}</p>
                  </div>
                  {analytics.last_activity_at && (
                    <div className="col-span-2 text-xs text-gray-500">
                      Last Activity: {new Date(analytics.last_activity_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Multi-Number Management */}
            <div className="border-b border-gray-200 pb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Connected Numbers</h3>
              {sessions.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          session.is_active
                            ? 'bg-green-50 border-green-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            {session.phone_number_display || session.phone_number || 'No number'}
                          </p>
                          <p className="text-xs text-gray-500">
                            Status: {session.status} {session.is_active && '• Active'}
                          </p>
                        </div>
                        {!session.is_active && session.status === 'ready' && (
                          <button
                            onClick={() => handleActivateSession(session.id)}
                            className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Only one number can be active at a time. Activating a number will deactivate others.
                  </p>
                </>
              ) : (
                <div className="text-center py-4 text-sm text-gray-500">
                  <p>No WhatsApp numbers connected yet.</p>
                  <p className="text-xs mt-1">Create a session to connect a number.</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-3 pt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Settings'}
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
