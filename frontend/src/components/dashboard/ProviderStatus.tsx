'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface ProviderStatusProps {
  subaccountId: string;
  ghlLocationId: string;
}

interface ProviderInstallation {
  id: string;
  conversation_provider_id: string;
  ghl_location_id: string;
  created_at: string;
}

export default function ProviderStatus({ subaccountId, ghlLocationId }: ProviderStatusProps) {
  const [provider, setProvider] = useState<ProviderInstallation | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProviderStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('provider_installations')
        .select('*')
        .eq('subaccount_id', subaccountId)
        .eq('ghl_location_id', ghlLocationId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching provider status:', error);
      } else {
        setProvider(data);
      }
    } catch (error) {
      console.error('Error fetching provider status:', error);
    } finally {
      setLoading(false);
    }
  }, [subaccountId, ghlLocationId]);

  useEffect(() => {
    fetchProviderStatus();
  }, [fetchProviderStatus]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-medium text-gray-900 mb-3">Provider Status</h3>
      
      {provider ? (
        <div className="space-y-2">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">Connected</p>
              <p className="text-xs text-gray-500">
                Provider ID: {provider.conversation_provider_id}
              </p>
            </div>
          </div>
          
          <div className="mt-3 p-3 bg-green-50 rounded-md">
            <p className="text-xs text-green-800">
              ✅ Your WhatsApp integration is active and ready to receive messages from LeadConnector.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">Not Connected</p>
              <p className="text-xs text-gray-500">
                Provider installation required
              </p>
            </div>
          </div>
          
          <div className="mt-3 p-3 bg-yellow-50 rounded-md">
            <p className="text-xs text-yellow-800">
              ⚠️ To enable two-way messaging, you need to configure the Conversations Provider in LeadConnector.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
