'use client'

import { useState, useEffect } from 'react'
import { Database } from '@/lib/supabase'
import Image from 'next/image'

type Session = Database['public']['Tables']['sessions']['Row']
type Subaccount = {
  id: string;
  user_id: string;
  location_id: string;
  company_id: string;
  conversation_provider_id: string | null;
  created_at: string;
}

interface SessionsListProps {
  sessions: Session[]
  selectedSession: Session | null
  onSelect: (session: Session) => void
  onCreate: () => void
  subaccount: Subaccount | null
}

export default function SessionsList({ 
  sessions, 
  selectedSession, 
  onSelect, 
  onCreate, 
  subaccount 
}: SessionsListProps) {
  const [pollingSessions, setPollingSessions] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)

  // Poll for session updates
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      for (const sessionId of pollingSessions) {
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/session/${sessionId}`, {
            credentials: 'include', // Send auth cookie
          })
          
          if (response.ok) {
            const sessionData = await response.json()
            
            // Update session in parent component
            if (sessionData.status === 'ready' || sessionData.status === 'disconnected') {
              setPollingSessions(prev => {
                const newSet = new Set(prev)
                newSet.delete(sessionId)
                return newSet
              })
            }
          }
        } catch (error) {
          console.error('Error polling session:', error)
        }
      }
    }, 2000)

    return () => clearInterval(pollInterval)
  }, [pollingSessions])

  const handleCreateSession = async () => {
    if (!subaccount || isCreating) return

    setIsCreating(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/create-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Send auth cookie
        body: JSON.stringify({
          subaccountId: subaccount.id,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to create session')
      }

      const { sessionId } = await response.json()
      
      // Start polling for this session
      setPollingSessions(prev => new Set([...prev, sessionId]))
      
      // Call parent onCreate to refresh sessions list
      onCreate()
      
    } catch (error) {
      console.error('Error creating session:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'bg-green-100 text-green-800'
      case 'qr':
        return 'bg-yellow-100 text-yellow-800'
      case 'initializing':
        return 'bg-blue-100 text-blue-800'
      case 'disconnected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready':
        return 'Connected'
      case 'qr':
        return 'Scan QR Code'
      case 'initializing':
        return 'Initializing'
      case 'disconnected':
        return 'Disconnected'
      default:
        return status
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">WhatsApp Sessions</h3>
        <button
          onClick={handleCreateSession}
          disabled={!subaccount || isCreating}
          className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreating ? 'Creating...' : 'Create Session'}
        </button>
      </div>

      {!subaccount ? (
        <p className="text-gray-500 text-sm">Select a subaccount to create sessions</p>
      ) : sessions.length === 0 ? (
        <p className="text-gray-500 text-sm">No sessions yet. Create one to start using WhatsApp.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onSelect(session)}
              className={`p-3 rounded-md cursor-pointer transition-colors ${
                selectedSession?.id === session.id
                  ? 'bg-indigo-50 border-2 border-indigo-200'
                  : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
              }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">
                    {session.phone_number || 'New Session'}
                  </h4>
                  <p className="text-xs text-gray-500">
                    Created {new Date(session.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                  {getStatusText(session.status)}
                </span>
              </div>
              
              {session.status === 'qr' && session.qr && (
                <div className="mt-4 flex flex-col items-center space-y-2">
                  <p className="text-sm text-gray-600 text-center">
                    Scan this QR code with your WhatsApp mobile app
                  </p>
                  <Image 
                    src={session.qr} 
                    alt="QR Code" 
                    width={192}
                    height={192}
                    className="w-48 h-48 border-2 border-gray-300 rounded-lg shadow-sm"
                  />
                  <p className="text-xs text-gray-500 text-center">
                    WhatsApp → Settings → Linked Devices → Link a Device
                  </p>
                </div>
              )}

              {session.status === 'initializing' && (
                <div className="mt-4 flex items-center justify-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                  <span className="text-sm text-gray-600">Initializing WhatsApp client...</span>
                </div>
              )}

              {session.status === 'ready' && (
                <div className="mt-4 flex items-center justify-center space-x-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                    ✅ Connected
                  </span>
                  <span className="text-sm text-gray-600">
                    {session.phone_number ? `Phone: ${session.phone_number}` : 'Ready to send messages'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
