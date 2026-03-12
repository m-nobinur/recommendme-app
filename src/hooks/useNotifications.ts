'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { showToast } from '@/lib/utils/toast'
import type { Notification, NotificationCategory, NotificationSeverity } from '@/types'

interface UseNotificationsOptions {
  organizationId: Id<'organizations'> | undefined
  category?: NotificationCategory
  limit?: number
  /** Disable real-time toast popups for incoming notifications */
  suppressToasts?: boolean
}

const SEVERITY_TO_TOAST: Record<NotificationSeverity, 'success' | 'error' | 'warning' | 'info'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
}

export function useNotifications({
  organizationId,
  category,
  limit,
  suppressToasts = false,
}: UseNotificationsOptions) {
  const notifications = useQuery(
    api.notifications.list,
    organizationId ? { organizationId, category, limit } : 'skip'
  )

  const unreadCountResult = useQuery(
    api.notifications.getUnreadCount,
    organizationId ? { organizationId } : 'skip'
  )

  const markReadMutation = useMutation(api.notifications.markRead)
  const markAllReadMutation = useMutation(api.notifications.markAllRead)
  const dismissMutation = useMutation(api.notifications.dismiss)

  // Track known notification IDs to detect new arrivals
  const knownIdsRef = useRef<Set<string>>(new Set())
  const isFirstLoad = useRef(true)

  useEffect(() => {
    if (!notifications || suppressToasts) return

    const items = notifications as Notification[]

    if (isFirstLoad.current) {
      knownIdsRef.current = new Set(items.map((n) => n._id))
      isFirstLoad.current = false
      return
    }

    for (const n of items) {
      if (!knownIdsRef.current.has(n._id) && !n.isRead) {
        knownIdsRef.current.add(n._id)
        showToast(SEVERITY_TO_TOAST[n.severity], n.title, {
          description: n.body,
          duration: 5000,
        })
      }
    }

    const currentIds = new Set(items.map((n) => n._id))
    for (const id of knownIdsRef.current) {
      if (!currentIds.has(id)) {
        knownIdsRef.current.delete(id)
      }
    }
  }, [notifications, suppressToasts])

  const markRead = useCallback(
    async (notificationId: Id<'notifications'>) => {
      if (!organizationId) return
      await markReadMutation({ organizationId, notificationId })
    },
    [organizationId, markReadMutation]
  )

  const markAllRead = useCallback(async () => {
    if (!organizationId) return
    await markAllReadMutation({ organizationId })
  }, [organizationId, markAllReadMutation])

  const dismiss = useCallback(
    async (notificationId: Id<'notifications'>) => {
      if (!organizationId) return
      await dismissMutation({ organizationId, notificationId })
    },
    [organizationId, dismissMutation]
  )

  const unreadCount = unreadCountResult?.count ?? 0

  const isLoading = notifications === undefined || unreadCountResult === undefined

  return useMemo(
    () => ({
      notifications: notifications ?? [],
      unreadCount,
      isLoading,
      markRead,
      markAllRead,
      dismiss,
    }),
    [notifications, unreadCount, isLoading, markRead, markAllRead, dismiss]
  )
}
