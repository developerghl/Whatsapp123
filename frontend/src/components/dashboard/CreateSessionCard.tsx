'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { API_BASE_URL } from '@/lib/config';

interface CreateSessionCardProps {
  subaccountId: string;
}

interface Session {
  id: string;
  status: 'initializing' | 'qr' | 'ready' | 'disconnected';
  qr: string | null;
  phone_number: string | null;
  created_at: string;
  mode?: 'qr' | 'pairing'; // Session mode
}

type Subaccount = {
  id: string;
  user_id: string;
  location_id: string;
  company_id: string;
  conversation_provider_id: string | null;
  created_at: string;
}

export default function CreateSessionCard({ subaccountId }: CreateSessionCardProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPairingCode, setShowPairingCode] = useState(false);

  const createSession = async (mode: 'qr' | 'pairing' = 'qr') => {
    try {
      setIsCreating(true);
      setError(null);

      // Get GHL location ID for the subaccount
      const ghlResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/ghl/subaccounts`, {
        credentials: 'include', // Send auth cookie
      });

      if (!ghlResponse.ok) {
        throw new Error('Failed to fetch GHL locations');
      }

      const { subaccounts } = await ghlResponse.json();
      const subaccount = subaccounts.find((acc: Subaccount) => acc.id === subaccountId);
      
      if (!subaccount) {
        throw new Error('GHL location not found');
      }

      // Open backend provider page with mode parameter
      const providerUrl = `${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}/ghl/provider?locationId=${subaccount.location_id}&mode=${mode}`;
      window.open(providerUrl, '_blank', 'width=600,height=800');
      
      setIsCreating(false);
    } catch (error) {
      console.error('Error creating session:', error);
      setError(error instanceof Error ? error.message : 'Failed to create session');
      setIsCreating(false);
    }
  };

  const pollSessionStatus = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/session/${sessionId}`, {
        credentials: 'include', // Send auth cookie
      });

      if (response.ok) {
        const sessionData = await response.json();
        setSession(sessionData);
        
        if (sessionData.status === 'ready') {
          return; // Stop polling
        }
      }
    } catch (error) {
      console.error('Error polling session status:', error);
    }

    // Continue polling if not ready
    if (session?.status !== 'ready') {
      setTimeout(() => pollSessionStatus(sessionId), 2000);
    }
  }, [session]);

  useEffect(() => {
    if (session && session.status !== 'ready') {
      const timer = setTimeout(() => pollSessionStatus(session.id), 2000);
      return () => clearTimeout(timer);
    }
  }, [session, pollSessionStatus]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'text-green-600 bg-green-100';
      case 'qr': return 'text-yellow-600 bg-yellow-100';
      case 'initializing': return 'text-blue-600 bg-blue-100';
      case 'disconnected': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready': return 'Connected';
      case 'qr': return 'Scan QR Code';
      case 'initializing': return 'Initializing...';
      case 'disconnected': return 'Disconnected';
      default: return 'Unknown';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4">WhatsApp Session</h3>
      
      {!session ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Create a new WhatsApp session to start messaging. You&apos;ll need to scan a QR code with your phone.
          </p>
          
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => createSession('qr')}
              disabled={isCreating}
              className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                  </svg>
                  Open QR Code
                </>
              )}
            </button>
            
            <button
              onClick={() => createSession('pairing')}
              disabled={isCreating}
              className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M2 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 002 2H4a2 2 0 01-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd" />
                    <path d="M15 8h1v1h-1V8zm0 2h1v1h-1v-1z" />
                  </svg>
                  Open Pairing Code
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                {getStatusText(session.status)}
              </span>
              {session.mode && (
                <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {session.mode === 'qr' ? '📱 QR Code' : '🔢 Pairing Code'}
                </span>
              )}
              {session.phone_number && (
                <span className="ml-2 text-sm text-gray-600">
                  {session.phone_number}
                </span>
              )}
            </div>
            
            {session.status === 'ready' && (
              <div className="flex items-center text-green-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>

          {session.status === 'qr' && session.qr && (
            <div className="text-center">
              {/* Show QR Code UI for QR mode sessions */}
              {session.mode === 'qr' && (
                <div>
                  <p className="text-sm text-gray-600 mb-3">
                    Scan this QR code with your WhatsApp mobile app:
                  </p>
                  <div className="inline-block p-4 bg-white border-2 border-gray-200 rounded-lg">
                    <Image 
                      src={session.qr} 
                      alt="WhatsApp QR Code" 
                      width={192}
                      height={192}
                      className="w-48 h-48"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Open WhatsApp → Menu → Linked Devices → Link a Device
                  </p>
                </div>
              )}

              {/* Show Pairing Code UI for pairing mode sessions */}
              {session.mode === 'pairing' && (
                <PairingCodeForm session={session} />
              )}

              {/* For sessions without mode (backward compatibility), show toggle */}
              {!session.mode && (
                <>
                  <div className="mb-4">
                    <div className="flex justify-center space-x-4">
                      <button
                        onClick={() => setShowPairingCode(false)}
                        className={`px-4 py-2 rounded-md text-sm font-medium ${
                          !showPairingCode
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        QR Code
                      </button>
                      <button
                        onClick={() => setShowPairingCode(true)}
                        className={`px-4 py-2 rounded-md text-sm font-medium ${
                          showPairingCode
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        Pairing Code
                      </button>
                    </div>
                  </div>

                  {!showPairingCode ? (
                    <div>
                      <p className="text-sm text-gray-600 mb-3">
                        Scan this QR code with your WhatsApp mobile app:
                      </p>
                      <div className="inline-block p-4 bg-white border-2 border-gray-200 rounded-lg">
                        <Image 
                          src={session.qr} 
                          alt="WhatsApp QR Code" 
                          width={192}
                          height={192}
                          className="w-48 h-48"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Open WhatsApp → Menu → Linked Devices → Link a Device
                      </p>
                    </div>
                  ) : (
                    <PairingCodeForm session={session} />
                  )}
                </>
              )}
            </div>
          )}

          {session.status === 'initializing' && (
            <div className="text-center">
              <div className="inline-flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm text-gray-600">Initializing WhatsApp connection...</span>
              </div>
            </div>
          )}

          {session.status === 'disconnected' && (
            <div className="text-center">
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-800">
                  Session disconnected. Please create a new session.
                </p>
              </div>
              <button
                onClick={() => setSession(null)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800"
              >
                Create New Session
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pairing Code Form Component
function PairingCodeForm({ session }: { session: Session }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRequestPairingCode = async () => {
    if (!phoneNumber.trim()) {
      setError('Please enter a phone number');
      return;
    }

    setIsLoading(true);
    setError(null);
    setPairingCode(null);

    try {
      // Extract location ID from session (assuming format: location_<locationId>_<sessionId>)
      const sessionParts = session.id.split('_');
      const locationId = sessionParts[1];
      const sessionId = sessionParts.slice(2).join('_');

      const response = await fetch(`${API_BASE_URL}/ghl/location/${locationId}/session/${sessionId}/pairing-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() })
      });

      const data = await response.json();

      if (response.ok) {
        setPairingCode(data.pairingCode);
        setError(null);
      } else {
        setError(data.error || 'Failed to request pairing code');
      }
    } catch (error) {
      console.error('Pairing code request error:', error);
      setError('Failed to request pairing code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-left">
        <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
          Phone Number
        </label>
        <div className="flex space-x-2">
          <input
            type="tel"
            id="phoneNumber"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="e.g., 1234567890 or +1234567890"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isLoading || !!pairingCode}
          />
          <button
            onClick={handleRequestPairingCode}
            disabled={isLoading || !!pairingCode || !phoneNumber.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Getting...' : 'Get Code'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Enter your phone number with country code (e.g., +1234567890)
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {pairingCode && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-800 mb-2">
              {pairingCode}
            </div>
            <p className="text-sm text-green-700 mb-3">
              Enter this 8-digit code in your WhatsApp app
            </p>
            <div className="text-xs text-green-600 space-y-1">
              <p>1. Open WhatsApp on your phone</p>
              <p>2. Go to Settings → Linked Devices</p>
              <p>3. Tap &quot;Link a Device&quot;</p>
              <p>4. Enter the code above</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
