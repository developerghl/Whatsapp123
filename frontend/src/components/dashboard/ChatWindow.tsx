'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/lib/supabase'

type Message = Database['public']['Tables']['messages']['Row']
type Session = Database['public']['Tables']['sessions']['Row']
type Subaccount = Database['public']['Tables']['subaccounts']['Row']

interface ChatWindowProps {
  session: Session | null
  subaccount: Subaccount | null
}

export default function ChatWindow({ session, subaccount }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [recipientPhone, setRecipientPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Fetch messages when session changes
  useEffect(() => {
    if (!session || !subaccount) {
      setMessages([])
      return
    }

    const fetchMessages = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', session.id)
          .eq('subaccount_id', subaccount.id)
          .order('created_at', { ascending: true })

        if (error) throw error
        setMessages(data || [])
      } catch (error) {
        console.error('Error fetching messages:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [session, subaccount, recipientPhone])

  // Subscribe to real-time message updates
  useEffect(() => {
    if (!session || !subaccount) return

    const channel = supabase
      .channel(`messages-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message
          // Only add if it belongs to the current subaccount
          if (newMessage.subaccount_id === subaccount.id) {
            setMessages(prev => [...prev, newMessage])
            
            // Auto-set recipient phone from incoming messages
            if (newMessage.direction === 'in' && !recipientPhone) {
              setRecipientPhone(newMessage.from_number)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          const updatedMessage = payload.new as Message
          if (updatedMessage.subaccount_id === subaccount.id) {
            setMessages(prev => 
              prev.map(msg => msg.id === updatedMessage.id ? updatedMessage : msg)
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, subaccount, recipientPhone])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !session || !recipientPhone.trim() || sending) return

    setSending(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Send auth cookie
        body: JSON.stringify({
          sessionId: session.id,
          to: recipientPhone.trim(),
          body: newMessage.trim(),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to send message')
      }

      setNewMessage('')
    } catch (error) {
      console.error('Error sending message:', error)
      // Note: ChatWindow might not have toast context, using console for now
      // If needed, can pass toast as prop or use a global notification system
      console.error('Failed to send message:', error)
    } finally {
      setSending(false)
    }
  }

  if (!session) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Chat</h3>
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">Select a session to start chatting</p>
        </div>
      </div>
    )
  }

  if (session.status !== 'ready') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Chat</h3>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-gray-500 mb-2">Session not ready</p>
            <p className="text-sm text-gray-400">Status: {session.status}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg flex flex-col h-96">
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">
          Chat - {session.phone_number || 'New Session'}
        </h3>
        <p className="text-sm text-gray-500">
          Session: {session.status} | Subaccount: {subaccount?.name}
        </p>
      </div>

      {/* Recipient Phone Input */}
      <div className="p-3 border-b border-gray-200 bg-gray-50">
        <div className="flex space-x-2">
          <input
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="Enter recipient phone number (e.g., +1234567890)"
            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
          <span className="text-xs text-gray-500 self-center">
            {recipientPhone ? 'Ready to chat' : 'Enter phone number'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            <span className="ml-2 text-gray-500">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-2">No messages yet</p>
            <p className="text-sm text-gray-400">
              {recipientPhone ? 'Send your first message below' : 'Enter a phone number to start chatting'}
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  message.direction === 'out'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-900'
                }`}
              >
                <p className="text-sm">{message.body}</p>
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs opacity-75">
                    {new Date(message.created_at).toLocaleTimeString()}
                  </p>
                  <p className="text-xs opacity-75">
                    {message.direction === 'out' ? 'You' : message.from_number}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} className="p-4 border-t border-gray-200">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            disabled={sending || !recipientPhone.trim()}
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim() || !recipientPhone.trim()}
            className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
