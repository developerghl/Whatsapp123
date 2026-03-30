'use client';

import { useState, useEffect, useCallback } from 'react';

interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  status: string;
  unreadCount: number;
}

interface GHLConversationsProps {
  locationId: string;
}

export default function GHLConversations({ locationId }: GHLConversationsProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [conversationMessages, setConversationMessages] = useState<{ body: string; direction: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/ghl/conversations?locationId=${locationId}&limit=50`, {
        credentials: 'include', // Send auth cookie
      });

      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    if (locationId) {
      fetchConversations();
    }
  }, [locationId, fetchConversations]);

  const fetchConversationMessages = async (conversationId: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/ghl/conversation/${conversationId}/messages?limit=50`, {
        credentials: 'include', // Send auth cookie
      });

      if (response.ok) {
        const data = await response.json();
        setConversationMessages(data.messages || []);
      }
    } catch (error) {
      console.error('Error fetching conversation messages:', error);
    }
  };

  const searchConversations = async () => {
    if (!searchQuery.trim()) {
      fetchConversations();
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/ghl/search-conversations?locationId=${locationId}&query=${encodeURIComponent(searchQuery)}`, {
        credentials: 'include', // Send auth cookie
      });

      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error('Error searching conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">GHL Conversations</h3>
        <p className="text-sm text-gray-500">Active conversations from LeadConnector</p>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex space-x-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={searchConversations}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      <div className="flex h-96">
        {/* Conversations List */}
        <div className="w-1/2 border-r border-gray-200 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No conversations found</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${
                    selectedConversation?.id === conversation.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                  }`}
                  onClick={() => {
                    setSelectedConversation(conversation);
                    fetchConversationMessages(conversation.id);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center">
                        <h4 className="text-sm font-medium text-gray-900 truncate">
                          {conversation.contactName || 'Unknown Contact'}
                        </h4>
                        {conversation.unreadCount > 0 && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            {conversation.unreadCount}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 truncate">
                        {conversation.contactPhone}
                      </p>
                      <p className="text-xs text-gray-400 truncate mt-1">
                        {conversation.lastMessage}
                      </p>
                    </div>
                    <div className="ml-2 text-right">
                      <p className="text-xs text-gray-500">
                        {formatTime(conversation.lastMessageTime)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDate(conversation.lastMessageTime)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conversation Messages */}
        <div className="w-1/2 p-4 overflow-y-auto">
          {selectedConversation ? (
            <div>
              <div className="mb-4 pb-2 border-b border-gray-200">
                <h4 className="text-sm font-medium text-gray-900">
                  {selectedConversation.contactName || 'Unknown Contact'}
                </h4>
                <p className="text-xs text-gray-500">
                  {selectedConversation.contactPhone}
                </p>
              </div>

              {conversationMessages.length === 0 ? (
                <div className="text-center text-gray-500">No messages found</div>
              ) : (
                <div className="space-y-3">
                  {conversationMessages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                          message.direction === 'out'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        <p>{message.body}</p>
                        <p className="text-xs opacity-75 mt-1">
                          {formatTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-500">
              Select a conversation to view messages
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
