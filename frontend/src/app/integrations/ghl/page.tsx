'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import ConnectGHLButton from '@/components/integrations/ConnectGHLButton';

interface GHLAccount {
  id: string;
  company_id: string;
  user_type: string;
  created_at: string;
}

export default function GHLIntegrationPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [ghlAccount, setGhlAccount] = useState<GHLAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchGHLAccount = useCallback(async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('ghl_accounts')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching GHL account:', error);
      } else {
        setGhlAccount(data);
      }
    } catch (error) {
      console.error('Error fetching GHL account:', error);
    }
  }, [user]);

  const checkAuthAndFetchAccount = useCallback(async () => {
    try {
      if (!user) {
        router.push('/login');
        return;
      }

      await fetchGHLAccount();
    } catch (error) {
      console.error('Auth check error:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [router, user, fetchGHLAccount]);

  useEffect(() => {
    checkAuthAndFetchAccount();
  }, [checkAuthAndFetchAccount]);

  const handleGHLConnected = () => {
    fetchGHLAccount();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">LeadConnector Integration</h1>
              <p className="mt-1 text-sm text-gray-500">
                Connect your LeadConnector account to enable WhatsApp messaging
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard-enhanced')}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Connection Status */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Connection Status</h2>
            
            {ghlAccount ? (
              <div className="space-y-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-900">Connected</p>
                    <p className="text-sm text-gray-500">
                      Company ID: {ghlAccount.company_id}
                    </p>
                    <p className="text-sm text-gray-500">
                      User Type: {ghlAccount.user_type}
                    </p>
                    <p className="text-sm text-gray-500">
                      Connected: {new Date(ghlAccount.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm text-green-800">
                    ✅ Your LeadConnector account is successfully connected. You can now create WhatsApp sessions and start messaging.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-900">Not Connected</p>
                    <p className="text-sm text-gray-500">
                      Connect your LeadConnector account to get started
                    </p>
                  </div>
                </div>
                
                <div className="mt-4">
                  <ConnectGHLButton onConnected={handleGHLConnected} />
                </div>
              </div>
            )}
          </div>

          {/* Setup Instructions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Setup Instructions</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-md font-medium text-gray-900 mb-2">1. LeadConnector App Configuration</h3>
                <div className="bg-gray-50 p-4 rounded-md">
                  <p className="text-sm text-gray-700 mb-2">
                    In your LeadConnector marketplace app, configure the following:
                  </p>
                  <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                    <li><strong>Redirect URI:</strong> <code className="bg-gray-200 px-1 rounded">{process.env.NEXT_PUBLIC_API_URL}/oauth/callback</code></li>
                    <li><strong>Scopes:</strong> locations.readonly, conversations.readonly, conversations.write</li>
                    <li><strong>Provider Type:</strong> Custom Conversations Provider</li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="text-md font-medium text-gray-900 mb-2">2. Conversations Provider Setup</h3>
                <div className="bg-gray-50 p-4 rounded-md">
                  <p className="text-sm text-gray-700 mb-2">
                    In LeadConnector, set up the Conversations Provider:
                  </p>
                  <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                    <li><strong>Provider Name:</strong> WhatsApp Integration</li>
                    <li><strong>Provider Type:</strong> Custom</li>
                    <li><strong>Always Show:</strong> Yes</li>
                    <li><strong>Delivery URL:</strong> <code className="bg-gray-200 px-1 rounded">{process.env.NEXT_PUBLIC_API_URL}/ghl/provider-outbound</code></li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="text-md font-medium text-gray-900 mb-2">3. Testing the Integration</h3>
                <div className="bg-gray-50 p-4 rounded-md">
                  <p className="text-sm text-gray-700 mb-2">
                    After connecting, you can test the integration:
                  </p>
                  <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                    <li>Create a WhatsApp session in the dashboard</li>
                    <li>Send test messages from LeadConnector Conversations</li>
                    <li>Verify messages appear in your WhatsApp</li>
                    <li>Test inbound messages from WhatsApp to LeadConnector</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* API Endpoints */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">API Endpoints</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Outbound (GHL → WhatsApp)</h3>
                <div className="bg-gray-50 p-3 rounded-md">
                  <code className="text-sm text-gray-700">
                    POST {process.env.NEXT_PUBLIC_API_URL}/ghl/provider-outbound
                  </code>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Message Status</h3>
                <div className="bg-gray-50 p-3 rounded-md">
                  <code className="text-sm text-gray-700">
                    POST {process.env.NEXT_PUBLIC_API_URL}/ghl/message-status
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
