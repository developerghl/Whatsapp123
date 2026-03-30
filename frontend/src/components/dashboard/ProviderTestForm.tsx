'use client';

import { useState } from 'react';

interface ProviderTestFormProps {
  subaccountId: string;
  ghlLocationId: string;
}

export default function ProviderTestForm({ ghlLocationId }: ProviderTestFormProps) {
  const [testData, setTestData] = useState({
    phone: '923001234567',
    message: 'Test message from LeadConnector integration',
    attachments: ''
  });
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleTest = async () => {
    try {
      setIsTesting(true);
      setResult(null);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ghl/provider-outbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locationId: ghlLocationId,
          phone: testData.phone,
          message: testData.message,
          attachments: testData.attachments ? [{ url: testData.attachments, mime: 'image/jpeg' }] : undefined,
          altId: `test_${Date.now()}`
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(`✅ Test successful! Message ID: ${data.messageId}`);
      } else {
        setResult(`❌ Test failed: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Test error:', error);
      setResult(`❌ Test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Provider Test</h3>
      <p className="text-sm text-gray-600 mb-4">
        Test the LeadConnector Conversations Provider integration by sending a test message.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Phone Number
          </label>
          <input
            type="tel"
            value={testData.phone}
            onChange={(e) => setTestData(prev => ({ ...prev, phone: e.target.value }))}
            placeholder="923001234567"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Message
          </label>
          <textarea
            value={testData.message}
            onChange={(e) => setTestData(prev => ({ ...prev, message: e.target.value }))}
            placeholder="Test message content"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Media URL (optional)
          </label>
          <input
            type="url"
            value={testData.attachments}
            onChange={(e) => setTestData(prev => ({ ...prev, attachments: e.target.value }))}
            placeholder="https://example.com/image.jpg"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <button
          onClick={handleTest}
          disabled={isTesting || !testData.phone || !testData.message}
          className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTesting ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Testing...
            </>
          ) : (
            'Send Test Message'
          )}
        </button>

        {result && (
          <div className={`p-3 rounded-md ${
            result.startsWith('✅') 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-red-50 border border-red-200'
          }`}>
            <p className={`text-sm ${
              result.startsWith('✅') ? 'text-green-800' : 'text-red-800'
            }`}>
              {result}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
