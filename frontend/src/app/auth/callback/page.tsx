'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Redirecting...')

  useEffect(() => {
    // Backend now handles all OAuth callbacks directly
    // This page should not be hit for GHL OAuth, but if it is, redirect immediately
    const error = searchParams.get('error')
    const success = searchParams.get('success')
    
    // If there's an error, redirect to login
    if (error) {
      setStatus('Authentication failed. Redirecting...')
      setTimeout(() => router.push('/login'), 1000)
      return
    }
    
    // Otherwise, redirect to dashboard (backend should have already handled this)
    // This is just a fallback
    setStatus('Redirecting to dashboard...')
    setTimeout(() => router.push('/dashboard'), 500)
  }, [searchParams, router])

  return (
    <div className="max-w-md w-full space-y-8 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
      <h2 className="text-xl font-semibold text-gray-900">{status}</h2>
      <p className="text-sm text-gray-600">Please wait while we complete your authentication...</p>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Suspense fallback={<div className="max-w-md w-full space-y-8 text-center" />}>
        <CallbackContent />
      </Suspense>
    </div>
  )
}
