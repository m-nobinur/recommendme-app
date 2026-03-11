'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { DashboardSidebarToggle } from '@/components/dashboard/DashboardSidebarToggle'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { useHeader } from '@/contexts'
import { signOut } from '@/lib/auth/client'
import { ROUTES, UI, Z_INDEX } from '@/lib/constants'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const { isHeaderVisible } = useHeader()
  const approvalNotificationIdsRef = useRef<Set<string>>(new Set())

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true)
    try {
      await signOut()
      router.push(ROUTES.LOGIN)
    } catch (error) {
      console.error('Sign out failed:', error)
      setIsSigningOut(false)
    }
  }, [router])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    let active = true
    const pollApprovals = async () => {
      try {
        const res = await fetch('/api/approvals?limit=10')
        if (!res.ok || !active) return
        const data = await res.json()
        if (!active || !Array.isArray(data.notifications)) return
        const approvalNotifications: Notification[] = data.notifications.map(
          (item: { _id: string; description?: string; riskLevel: string; createdAt: number }) => ({
            id: item._id,
            title: item.description ?? `Pending ${item.riskLevel}-risk approval`,
            type: 'warning' as const,
            read: false,
            time: new Date(item.createdAt).toLocaleString(),
          })
        )
        setNotifications((prev) => {
          const latestApprovalIds = new Set(
            approvalNotifications.map((notification) => notification.id)
          )
          const previousApprovalIds = approvalNotificationIdsRef.current
          const byId = new Map(prev.map((notification) => [notification.id, notification]))
          const syncedApprovalNotifications = approvalNotifications.map((notification) => {
            const existing = byId.get(notification.id)
            return existing ? { ...notification, read: existing.read } : notification
          })
          const retainedNonApprovalNotifications = prev.filter((notification) => {
            if (!previousApprovalIds.has(notification.id)) {
              return true
            }
            return latestApprovalIds.has(notification.id)
          })
          const retainedIds = new Set(
            syncedApprovalNotifications.map((notification) => notification.id)
          )
          const passthroughNotifications = retainedNonApprovalNotifications.filter(
            (notification) => !retainedIds.has(notification.id)
          )
          approvalNotificationIdsRef.current = latestApprovalIds
          return [...syncedApprovalNotifications, ...passthroughNotifications]
        })
      } catch {
        // Silently ignore polling failures
      }
    }
    pollApprovals()
    const interval = setInterval(pollApprovals, 60_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  const handleMarkAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-primary text-text-primary font-sans selection:bg-brand/30 relative">
      {/* Header */}
      <DashboardHeader
        isVisible={isHeaderVisible}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
      />

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 w-80 transform transition-all duration-300 ease-out border-r border-border bg-surface-secondary ${
          sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
        }`}
        style={{
          top: isHeaderVisible ? `${UI.HEADER_HEIGHT}px` : '0px',
          zIndex: Z_INDEX.SIDEBAR,
        }}
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
      <div
        className="fixed bottom-4 left-0 right-0 px-8 flex justify-between items-end pointer-events-none"
        style={{ zIndex: Z_INDEX.DROPDOWN }}
      >
        {/* Left: Sidebar Toggle */}
        <DashboardSidebarToggle isOpen={sidebarOpen} onToggle={toggleSidebar} />

        {/* Right: Spacer to balance layout */}
        <div className="w-10" />
      </div>
    </div>
  )
}
