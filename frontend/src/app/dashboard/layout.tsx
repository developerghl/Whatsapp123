'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import Link from 'next/link'
// switched header logo to native <img> to use public favicon directly

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading, logout } = useAuth()
  const pathname = usePathname()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-indigo-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const navigation = [
    { 
      name: 'Dashboard', 
      href: '/dashboard', 
      current: pathname === '/dashboard',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    // { 
    //   name: 'Analytics', 
    //   href: '/dashboard/analytics', 
    //   current: pathname === '/dashboard/analytics',
    //   icon: (
    //     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    //       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3v18M6 13v8M16 8v13M21 5v16" />
    //     </svg>
    //   )
    // },
    { 
      name: 'Accounts', 
      href: '/dashboard/accounts', 
      current: pathname === '/dashboard/accounts',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    { 
      name: 'Subscription', 
      href: '/dashboard/subscription', 
      current: pathname === '/dashboard/subscription',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      )
    },
    { 
      name: 'Billing', 
      href: '/dashboard/billing', 
      current: pathname === '/dashboard/billing',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    { 
      name: 'Settings', 
      href: '/dashboard/settings', 
      current: pathname === '/dashboard/settings',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-1.14 1.951-1.14 2.25 0a1.724 1.724 0 002.573 1.066c1.003-.59 2.18.588 1.59 1.59a1.724 1.724 0 001.066 2.573c1.14.3 1.14 1.951 0 2.25a1.724 1.724 0 00-1.066 2.573c.59 1.003-.588 2.18-1.59 1.59a1.724 1.724 0 00-2.573 1.066c-.3 1.14-1.951 1.14-2.25 0a1.724 1.724 0 00-2.573-1.066c-1.003.59-2.18-.588-1.59-1.59a1.724 1.724 0 00-1.066-2.573c-1.14-.3-1.14-1.951 0-2.25a1.724 1.724 0 001.066-2.573c-.59-1.003.588-2.18 1.59-1.59.94.553 2.12.09 2.573-1.066z" />
        </svg>
      )
    },
    { 
      name: 'Help Center', 
      href: 'https://www.octendr.com/help', 
      current: false,
      external: true,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
  ]

  return (
    <div className="h-screen overflow-hidden bg-gray-50">
      {/* Top Navigation - Modern Compact Header */}
      <nav className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50 shadow-sm">
        <div className="px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center space-x-3">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-indigo-600 flex items-center justify-center shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/favicon.ico" alt="Octendr" width={20} height={20} className="object-contain" />
              </div>
              <div>
                <h1 className="text-base font-bold text-gray-900">Octendr</h1>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-gray-50/80 rounded-lg border border-gray-200/50">
                <div className="w-7 h-7 bg-gradient-to-br from-emerald-500 to-indigo-600 rounded-full flex items-center justify-center shadow-sm">
                  <span className="text-xs font-semibold text-white">
                    {(user?.name || user?.email)?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium text-gray-900 leading-tight">
                    {user?.name && user.name.trim() ? user.name.split(' ')[0] : user?.email?.split('@')[0] || 'User'}
                  </p>
                  <p className="text-[10px] text-gray-500 leading-tight">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="flex items-center space-x-1.5 text-xs text-gray-600 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100/80"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-56px)] overflow-hidden">
          {/* Sidebar - Modern Design */}
        <aside className="w-64 bg-white/50 backdrop-blur-sm border-r border-gray-200/50 overflow-y-auto">
          <div className="p-3">
            <nav className="space-y-0.5">
                {navigation.map((item) => {
                  const linkProps = item.external 
                    ? { href: item.href, target: '_blank', rel: 'noopener noreferrer' }
                    : { href: item.href };
                  
                  return (
                    <Link
                      key={item.name}
                      {...linkProps}
                      className={`${
                        item.current
                        ? 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-700 shadow-sm'
                        : 'text-gray-700 hover:bg-gray-50/80 hover:text-gray-900'
                    } group flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200`}
                    >
                      <span className={`${item.current ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'} mr-3 flex-shrink-0`}>
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.name}</span>
                      {item.external && (
                        <svg className="w-3.5 h-3.5 ml-auto text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      )}
                    </Link>
                  );
                })}
            </nav>
            
            {/* Sidebar Footer - Compact */}
            <div className="mt-6 pt-4 border-t border-gray-200/50">
              <div className="px-3 space-y-1.5">
                <div className="flex items-center text-[10px] text-gray-400">
                  <svg className="w-3 h-3 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Version 1.0.1
                </div>
                <div className="flex items-center text-[10px] text-gray-400">
                  <svg className="w-3 h-3 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Secure Connection
                </div>
              </div>
            </div>
          </div>
        </aside>

          {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-gradient-to-br from-gray-50 via-white to-gray-50">
          <div className="max-w-7xl mx-auto px-6 py-6">
        {children}
          </div>
        </main>
      </div>
    </div>
  )
}
