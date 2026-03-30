'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading } = useAuth()
  const [status, setStatus] = useState('Verifying...')

  useEffect(() => {
    // Wait for auth to initialize
    if (loading) return;

    // Backend now handles most normal OAuth callbacks directly
    // This page handles fallback and specifically the GHL marketplace install flow
    const error = searchParams.get('error')
    const marketplaceInstall = searchParams.get('marketplace_install')
    const code = searchParams.get('code')
    const locationId = searchParams.get('locationId')
    
    // If there's an error, redirect to login
    if (error) {
      setStatus('Authentication failed. Redirecting...')
      setTimeout(() => router.push('/login'), 1000)
      return
    }

    if (marketplaceInstall && code) {
      if (!user) {
        setStatus('Please login to complete installation...')
        // Remember the full path + query to return here after login
        const currentUrl = encodeURIComponent(window.location.pathname + window.location.search)
        setTimeout(() => window.location.href = `/login?redirect=${currentUrl}`, 500)
        return
      } else {
        setStatus('Completing installation...')
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        // Redirect back to backend OAuth with the state (user ID) now appended!
        window.location.href = `${apiUrl}/oauth/callback?code=${code}&locationId=${locationId || ''}&state=${user.id}`
        return
      }
    }
    
    // Otherwise, redirect to dashboard
    setStatus('Redirecting to dashboard...')
    setTimeout(() => router.push('/dashboard'), 500)
  }, [searchParams, router, user, loading])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 text-center p-8 bg-white shadow-xl rounded-2xl border border-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
        <h2 className="text-xl font-semibold text-gray-900">{status}</h2>
        <p className="text-sm text-gray-500">Please wait while we complete your request...</p>
      </div>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
