'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { DashboardSidebarToggle } from '@/components/dashboard/DashboardSidebarToggle'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { useHeader } from '@/contexts'
import { signOut } from '@/lib/auth/client'
import { UI } from '@/lib/constants'
import type { AppointmentDisplay, InvoiceDisplay, LeadDisplay, Notification, User } from '@/types'

interface DashboardShellProps {
  children: ReactNode
  user: User
  leads?: LeadDisplay[]
  appointments?: AppointmentDisplay[]
  invoices?: InvoiceDisplay[]
  notifications?: Notification[]
}

export function DashboardShell({
  children,
  user,
  leads = [],
  appointments = [],
  invoices = [],
  notifications: initialNotifications = [],
}: DashboardShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const isOnChat = pathname === '/chat' || pathname.startsWith('/chat/')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const { isHeaderVisible } = useHeader()

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true)
    try {
      await signOut()
      router.push('/login')
    } catch (error) {
      console.error('Sign out failed:', error)
      setIsSigningOut(false)
    }
  }, [router])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  const handleMarkAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-primary text-gray-200 font-sans selection:bg-amber-500/30 relative">
      {/* Header */}
      <DashboardHeader
        isVisible={isHeaderVisible}
        isOnChat={isOnChat}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
      />

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-80 transform transition-all duration-300 ease-out border-r border-border bg-surface-secondary ${
          sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
        }`}
        style={{ top: isHeaderVisible ? `${UI.HEADER_HEIGHT}px` : '0px' }}
      >
        <div className="h-full w-80">
          <DashboardView
            user={user}
            leads={leads}
            appointments={appointments}
            invoices={invoices}
            onSignOut={handleSignOut}
            isSigningOut={isSigningOut}
          />
        </div>
      </div>

      {/* Main Content */}
      <div
        className={`flex-1 flex flex-col h-full relative min-w-0 bg-surface-primary transition-all duration-300 ease-in-out ${
          isHeaderVisible ? 'pt-16' : 'pt-0'
        }`}
      >
        {/* View Area */}
        <div className="flex-1 overflow-hidden relative w-full flex flex-col">{children}</div>
      </div>

      {/* Bottom Floating Controls */}
      <div className="fixed bottom-4 left-0 right-0 px-8 flex justify-between items-end pointer-events-none z-50">
        {/* Left: Sidebar Toggle */}
        <DashboardSidebarToggle isOpen={sidebarOpen} onToggle={toggleSidebar} />

        {/* Right: Spacer to balance layout */}
        <div className="w-10" />
      </div>
    </div>
  )
}
