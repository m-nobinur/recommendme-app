'use client'

import { api } from '@convex/_generated/api'
import { useQuery } from 'convex/react'
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { usePushNotifications } from '@/hooks'
import { cn } from '@/lib/utils/cn'
import { showToast } from '@/lib/utils/toast'
import { useDevModeStore } from '@/stores'

const PushNotificationToggle = memo(function PushNotificationToggle() {
  const isDev = process.env.NODE_ENV === 'development'
  const authMode = useDevModeStore((s) => s.authMode)
  const isDevMode = isDev && authMode === 'dev'
  const authUser = useQuery(api.auth.getCurrentUser)
  const needsDevFallback = isDevMode && !authUser
  const devAppUser = useQuery(api.appUsers.getDevAppUser, needsDevFallback ? {} : 'skip')
  const resolvedAuthId = authUser?._id ?? (isDevMode ? devAppUser?.authUserId : undefined)
  const appUser = useQuery(
    api.appUsers.getAppUserByAuthId,
    resolvedAuthId ? { authUserId: resolvedAuthId } : 'skip'
  )
  const organizationId = appUser?.organizationId

  const { permissionState, isSubscribed, isRegistering, isSupported, subscribe, unsubscribe } =
    usePushNotifications({ organizationId })

  const [isToggling, setIsToggling] = useState(false)

  const handleToggle = useCallback(async () => {
    setIsToggling(true)
    try {
      if (isSubscribed) {
        const ok = await unsubscribe()
        if (ok) showToast('info', 'Push notifications disabled')
        else showToast('error', 'Failed to disable push notifications')
      } else {
        const ok = await subscribe()
        if (ok) showToast('success', 'Push notifications enabled')
        else if (permissionState === 'denied')
          showToast('warning', 'Notification permission denied', {
            description: 'Update your browser settings to allow notifications from this site.',
          })
        else showToast('error', 'Failed to enable push notifications')
      }
    } finally {
      setIsToggling(false)
    }
  }, [isSubscribed, subscribe, unsubscribe, permissionState])

  if (!isSupported) {
    return (
      <section className="rounded-xl border border-border bg-surface-secondary p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-surface-elevated flex items-center justify-center">
            <BellOff className="w-5 h-5 text-text-disabled" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Push Notifications</h3>
            <p className="text-xs text-text-muted">Not supported in this browser</p>
          </div>
        </div>
      </section>
    )
  }

  const StatusIcon = isSubscribed ? BellRing : Bell
  const loading = isRegistering || isToggling

  return (
    <section className="rounded-xl border border-border bg-surface-secondary p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center',
              isSubscribed ? 'bg-brand/10' : 'bg-surface-elevated'
            )}
          >
            <StatusIcon
              className={cn('w-5 h-5', isSubscribed ? 'text-brand' : 'text-text-muted')}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Push Notifications</h3>
            <p className="text-xs text-text-muted">
              {isSubscribed
                ? 'You will receive native notifications for important events'
                : 'Get notified even when the app is not open'}
            </p>
            {permissionState === 'denied' && (
              <p className="text-xs text-status-error mt-1">
                Permission blocked — update browser settings to enable
              </p>
            )}
          </div>
        </div>

        <Button
          variant={isSubscribed ? 'ghost' : 'primary'}
          onClick={handleToggle}
          disabled={loading || permissionState === 'denied'}
          className="min-w-[100px]"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isSubscribed ? (
            'Disable'
          ) : (
            'Enable'
          )}
        </Button>
      </div>
    </section>
  )
})

export { PushNotificationToggle }
