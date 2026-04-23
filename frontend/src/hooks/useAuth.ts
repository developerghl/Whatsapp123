import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export interface User {
  id: string
  email: string
  name?: string
  subscription_status: string | null
  subscription_plan: string | null
  trial_ends_at: string | null
  max_subaccounts: number
}

function userFromRow(data: {
  id: string
  email: string
  name?: string | null
  subscription_status?: string | null
  subscription_plan?: string | null
  trial_ends_at?: string | null
  max_subaccounts?: number | null
}): User {
  return {
    id: data.id,
    name: (data.name as string | undefined) ?? undefined,
    email: data.email,
    subscription_status: data.subscription_status ?? null,
    subscription_plan: data.subscription_plan ?? null,
    trial_ends_at: data.trial_ends_at ?? null,
    max_subaccounts: data.max_subaccounts ?? 0,
  }
}

export function useAuth() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    if (!user?.id) return
    const { data } = await supabase
      .from('users')
      .select('id, name, email, subscription_status, subscription_plan, trial_ends_at, max_subaccounts')
      .eq('id', user.id)
      .maybeSingle()
    if (data) {
      const next = userFromRow(data)
      setUser(next)
      localStorage.setItem('user', JSON.stringify(next))
    }
  }, [user?.id])

  useEffect(() => {
    const init = async () => {
      const userData = localStorage.getItem('user')

      if (!userData) {
        router.push('/login')
        return
      }

      const parsed = JSON.parse(userData) as Record<string, unknown>
      const interim: User = {
        id: String(parsed.id),
        email: String(parsed.email),
        name: parsed.name != null ? String(parsed.name) : undefined,
        subscription_status: (parsed.subscription_status as string) ?? null,
        subscription_plan: (parsed.subscription_plan as string) ?? null,
        trial_ends_at: (parsed.trial_ends_at as string) ?? null,
        max_subaccounts: typeof parsed.max_subaccounts === 'number' ? parsed.max_subaccounts : 0,
      }
      setUser(interim)

      try {
        const { data } = await supabase
          .from('users')
          .select('id, name, email, subscription_status, subscription_plan, trial_ends_at, max_subaccounts')
          .eq('id', interim.id)
          .maybeSingle()

        if (data) {
          const refreshed = userFromRow(data)
          setUser(refreshed)
          localStorage.setItem('user', JSON.stringify(refreshed))
        }
      } catch {
        // ignore; keep local values
      } finally {
        setLoading(false)
      }
    }

    void init()
  }, [router])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    localStorage.removeItem('user')
    window.location.href = '/login'
  }

  return { user, loading, logout, refreshUser }
}
