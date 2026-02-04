'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing...')

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const error = searchParams.get('error')
        const ghlConnected = searchParams.get('ghl')
        const userParam = searchParams.get('user')
        const isAgency = searchParams.get('agency')
        const locationsCount = searchParams.get('locations')

        if (error) {
          setStatus('Authentication failed. Redirecting to login...')
          setTimeout(() => router.push('/login'), 2000)
          return
        }

        // If GHL OAuth callback with user data
        if (ghlConnected && userParam) {
          try {
            const userData = JSON.parse(decodeURIComponent(userParam))
            localStorage.setItem('user', JSON.stringify(userData))
            
            // Show different message for agency vs single location
            if (isAgency === 'true' && locationsCount) {
              setStatus(`🏢 Agency connected successfully! ${locationsCount} locations imported. Redirecting...`)
            } else {
              setStatus('✅ GHL account connected! Redirecting to accounts...')
            }
            
            // Redirect to accounts page instead of dashboard
            setTimeout(() => router.push('/dashboard/accounts?ghl=connected&success=account_added'), 2000)
            return
          } catch (e) {
            console.error('Error parsing user data:', e)
          }
        }

        // Check if user is logged in (via cookie set by backend)
        const userData = localStorage.getItem('user')
        
        if (userData) {
          setStatus('Login successful! Redirecting to dashboard...')
          setTimeout(() => router.push('/dashboard'), 1000)
        } else {
          // If no user data, redirect to login
          setStatus('Authentication incomplete. Redirecting to login...')
          setTimeout(() => router.push('/login'), 2000)
        }
      } catch (error) {
        console.error('Auth callback error:', error)
        setStatus('Authentication failed. Redirecting to login...')
        setTimeout(() => router.push('/login'), 2000)
      }
    }

    handleAuthCallback()
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
