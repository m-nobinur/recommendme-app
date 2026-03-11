'use client'

import { api } from '@convex/_generated/api'
import { useQuery } from 'convex/react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { DashboardSidebarToggle } from '@/components/dashboard/DashboardSidebarToggle'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { useHeader } from '@/contexts'
import { signOut } from '@/lib/auth/client'
import { ROUTES, UI, Z_INDEX } from '@/lib/constants'
import { useDevModeStore } from '@/stores'
import type { AppointmentDisplay, InvoiceDisplay, LeadDisplay, Notification, User } from '@/types'

interface DashboardShellProps {
  children: ReactNode
  user: User
  notifications?: Notification[]
}

export function DashboardShell({
  children,
  user,
  notifications: initialNotifications = [],
}: DashboardShellProps) {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarDataActivated, setSidebarDataActivated] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const { isHeaderVisible } = useHeader()
  const approvalNotificationIdsRef = useRef<Set<string>>(new Set())
  const [nowMs, setNowMs] = useState(() => Date.now())

  const isDev = process.env.NODE_ENV === 'development'
  const { authMode } = useDevModeStore()
  const isDevMode = isDev && authMode === 'dev'

  useEffect(() => {
    if (sidebarOpen && !sidebarDataActivated) {
      setSidebarDataActivated(true)
    }
  }, [sidebarOpen, sidebarDataActivated])

  const authUser = useQuery(api.auth.getCurrentUser)
  const needsDevFallback = isDevMode && !authUser
  const devAppUser = useQuery(api.appUsers.getDevAppUser, needsDevFallback ? {} : 'skip')
  const resolvedAuthId = authUser?._id ?? (isDevMode ? devAppUser?.authUserId : undefined)

  const appUser = useQuery(
    api.appUsers.getAppUserByAuthId,
    resolvedAuthId ? { authUserId: resolvedAuthId } : 'skip'
  )

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const pendingApprovals = useQuery(
    api.approvalQueue.listPending,
    appUser
      ? {
          userId: appUser._id,
          organizationId: appUser.organizationId,
          now: nowMs,
          limit: 10,
        }
      : 'skip'
  )

  const leadsData = useQuery(
    api.leads.list,
    appUser && sidebarDataActivated
      ? { userId: appUser._id, organizationId: appUser.organizationId, limit: 50 }
      : 'skip'
  )

  const appointmentsData = useQuery(
    api.appointments.list,
    appUser && sidebarDataActivated
      ? { userId: appUser._id, organizationId: appUser.organizationId, limit: 30 }
      : 'skip'
  )

  const invoicesData = useQuery(
    api.invoices.list,
    appUser && sidebarDataActivated
      ? { userId: appUser._id, organizationId: appUser.organizationId, limit: 30 }
      : 'skip'
  )

  const leads: LeadDisplay[] = useMemo(
    () =>
      (leadsData ?? []).map((lead) => ({
        id: lead._id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        status: lead.status,
        value: lead.value,
        tags: lead.tags,
        notes: lead.notes,
      })),
    [leadsData]
  )

  const appointments: AppointmentDisplay[] = useMemo(
    () =>
      (appointmentsData ?? []).map((appt) => ({
        id: appt._id,
        title: appt.title ?? 'Appointment',
        date: appt.date,
        time: appt.time,
        leadName: appt.leadName,
        status: appt.status,
      })),
    [appointmentsData]
  )

  const invoices: InvoiceDisplay[] = useMemo(
    () =>
      (invoicesData ?? []).map((inv) => ({
        id: inv._id,
        leadName: inv.leadName,
        amount: inv.amount,
        status: inv.status,
      })),
    [invoicesData]
  )

  const approvalNotifications = useMemo(
    () =>
      (pendingApprovals ?? []).map(
        (item: { _id: string; description?: string; riskLevel: string; createdAt: number }) => ({
          id: item._id,
          title: item.description ?? `Pending ${item.riskLevel}-risk approval`,
          type: 'warning' as const,
          read: false,
          time: new Date(item.createdAt).toLocaleString(),
        })
      ),
    [pendingApprovals]
  )

  const mergedNotifications = useMemo(() => {
    const latestApprovalIds = new Set(approvalNotifications.map((notification) => notification.id))
    const previousApprovalIds = approvalNotificationIdsRef.current
    const previousById = new Map(
      notifications.map((notification) => [notification.id, notification])
    )

    const syncedApprovalNotifications = approvalNotifications.map((notification) => {
      const existing = previousById.get(notification.id)
      return existing ? { ...notification, read: existing.read } : notification
    })

    const retainedNonApprovalNotifications = notifications.filter((notification) => {
      if (!previousApprovalIds.has(notification.id)) {
        return true
      }
      return latestApprovalIds.has(notification.id)
    })

    const retainedIds = new Set(syncedApprovalNotifications.map((notification) => notification.id))
    const passthroughNotifications = retainedNonApprovalNotifications.filter(
      (notification) => !retainedIds.has(notification.id)
    )

    return {
      list: [...syncedApprovalNotifications, ...passthroughNotifications],
      latestApprovalIds,
    }
  }, [approvalNotifications, notifications])

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
    const prevIds = notifications.map((n) => n.id).join('|')
    const nextIds = mergedNotifications.list.map((n) => n.id).join('|')
    const prevRead = notifications.map((n) => Number(n.read)).join('')
    const nextRead = mergedNotifications.list.map((n) => Number(n.read)).join('')

    approvalNotificationIdsRef.current = mergedNotifications.latestApprovalIds

    if (
      prevIds === nextIds &&
      prevRead === nextRead &&
      notifications.length === mergedNotifications.list.length
    ) {
      return
    }

    setNotifications(mergedNotifications.list)
  }, [mergedNotifications, notifications])

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
