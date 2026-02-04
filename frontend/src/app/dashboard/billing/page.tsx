'use client'

import { useAuth } from '@/hooks/useAuth'
import { useEffect, useState } from 'react'
import { API_ENDPOINTS, apiCall } from '@/lib/config'

interface StripeInvoice {
  id: string
  number: string | null
  amount: number
  currency: string
  status: string
  created: string
  due_date: string | null
  paid_at: string | null
  invoice_pdf: string | null
  hosted_invoice_url: string | null
  description: string
  plan: string
}

export default function BillingPage() {
  const { user } = useAuth()
  const [invoices, setInvoices] = useState<StripeInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchInvoices = async () => {
      if (!user?.id) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        
        const response = await apiCall(API_ENDPOINTS.getInvoices, {
          method: 'GET'
        })

        if (!response.ok) {
          throw new Error('Failed to fetch invoices')
        }

        const data = await response.json()
        setInvoices(data.invoices || [])
      } catch (error) {
        console.error('Error fetching invoices:', error)
        setError('Failed to load invoices. Please try again later.')
      } finally {
        setLoading(false)
      }
    }

    fetchInvoices()
  }, [user])

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2
    }).format(amount / 100) // Stripe amounts are in cents
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string; label: string }> = {
      paid: { bg: 'bg-green-100', text: 'text-green-800', label: 'Paid' },
      open: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Open' },
      void: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Void' },
      uncollectible: { bg: 'bg-red-100', text: 'text-red-800', label: 'Uncollectible' },
      draft: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Draft' }
    }
    
    const statusStyle = statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status }
    
    return (
      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
        {statusStyle.label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invoices...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Billing & Invoices</h1>
        <p className="text-gray-600 mt-1">View your Stripe invoice history</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Invoice History */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-8 py-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Invoice History</h2>
          <p className="text-sm text-gray-500 mt-1">All invoices from Stripe</p>
        </div>
        
        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Invoice #</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Description</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {invoice.number || invoice.id.slice(-8)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDate(invoice.created)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={invoice.description}>
                      {invoice.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                      {formatCurrency(invoice.amount, invoice.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(invoice.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {invoice.hosted_invoice_url && (
                        <a
                          href={invoice.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center"
                        >
                          View
                          <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      {invoice.invoice_pdf && !invoice.hosted_invoice_url && (
                        <a
                          href={invoice.invoice_pdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center"
                        >
                          PDF
                          <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-20 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No invoices yet</h3>
            <p className="text-gray-500">Your invoice history will appear here once you make a payment</p>
          </div>
        )}
      </div>
    </div>
  )
}

