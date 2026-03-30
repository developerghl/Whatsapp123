'use client';

import { useState, useEffect, useCallback } from 'react';

interface GHLLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  phoneNumber: string;
  timezone: string;
  website: string;
  businessId: string;
  companyId: string;
}

interface GHLLocationSelectorProps {
  onLocationSelect: (location: GHLLocation) => void;
}

export default function GHLLocationSelector({ onLocationSelect }: GHLLocationSelectorProps) {
  const [locations, setLocations] = useState<GHLLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/ghl/locations`, {
        credentials: 'include', // Send auth cookie
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch locations');
      }

      const data = await response.json();
      setLocations(data.locations || []);
    } catch (error) {
      console.error('Error fetching LeadConnector locations:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch locations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">LeadConnector locations</h3>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">LeadConnector locations</h3>
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={fetchLocations}
            className="mt-2 px-3 py-1 text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">LeadConnector locations</h3>
        <button
          onClick={fetchLocations}
          className="px-3 py-1 text-xs font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {locations.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">No locations found in your LeadConnector account</p>
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((location) => (
            <div
              key={location.id}
              onClick={() => onLocationSelect(location)}
              className="p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-gray-900">{location.name}</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    {location.address && `${location.address}, `}
                    {location.city && `${location.city}, `}
                    {location.state && `${location.state}, `}
                    {location.country}
                  </p>
                  {location.phoneNumber && (
                    <p className="text-xs text-gray-500 mt-1">Phone: {location.phoneNumber}</p>
                  )}
                </div>
                <div className="ml-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Create Session
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
