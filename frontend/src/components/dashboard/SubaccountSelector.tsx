'use client'

import { useState } from 'react'
import { Database } from '@/lib/supabase'

type Subaccount = Database['public']['Tables']['subaccounts']['Row']

interface SubaccountSelectorProps {
  subaccounts: Subaccount[]
  selectedSubaccount: Subaccount | null
  onSubaccountChange: (subaccount: Subaccount) => void
}

export default function SubaccountSelector({ 
  subaccounts, 
  selectedSubaccount, 
  onSubaccountChange
}: SubaccountSelectorProps) {
  const [connecting, setConnecting] = useState<string | null>(null)

  const connectSubaccount = async (subaccount: Subaccount) => {
    setConnecting(subaccount.id)
    try {
      // Call backend to connect this subaccount
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/ghl/connect-subaccount`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Send auth cookie
        body: JSON.stringify({
          ghl_location_id: subaccount.ghl_location_id,
          name: subaccount.name
        }),
      })

      if (response.ok) {
        // Select the connected subaccount
        onSubaccountChange(subaccount)
        console.log('Subaccount connected successfully')
      } else {
        console.error('Failed to connect subaccount')
      }
    } catch (error) {
      console.error('Error connecting subaccount:', error)
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">LeadConnector locations</h3>
      </div>

      <div className="space-y-2">
        {subaccounts.length === 0 ? (
          <p className="text-gray-500 text-sm">No locations found. Connect your LeadConnector account first.</p>
        ) : (
          subaccounts.map((subaccount) => (
            <div
              key={subaccount.id}
              onClick={() => connectSubaccount(subaccount)}
              className={`p-3 rounded-md cursor-pointer transition-colors ${
                selectedSubaccount?.id === subaccount.id
                  ? 'bg-indigo-50 border-2 border-indigo-200'
                  : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
              }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">{subaccount.name}</h4>
                  <p className="text-xs text-gray-500">
                    Location ID: {subaccount.ghl_location_id}
                  </p>
                </div>
                {connecting === subaccount.id ? (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Connecting...
                  </span>
                ) : selectedSubaccount?.id === subaccount.id ? (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    ✓ Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    Click to Connect
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
