'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type PushPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

interface UsePushNotificationsOptions {
  organizationId: Id<'organizations'> | undefined
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushNotifications({ organizationId }: UsePushNotificationsOptions) {
  const [permissionState, setPermissionState] = useState<PushPermissionState>('prompt')
  const [isRegistering, setIsRegistering] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  const subscribeMutation = useMutation(api.pushSubscriptions.subscribe)
  const unsubscribeMutation = useMutation(api.pushSubscriptions.unsubscribe)
  const existingSubs = useQuery(
    api.pushSubscriptions.getMySubscription,
    organizationId ? { organizationId } : 'skip'
  )

  useEffect(() => {
    if (!isPushSupported()) {
      setPermissionState('unsupported')
      return
    }
    setPermissionState(Notification.permission as PushPermissionState)
  }, [])

  useEffect(() => {
    if (!isPushSupported()) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registrationRef.current = reg
      })
      .catch((err) => {
        console.warn('[Push] Service worker registration failed:', err)
      })
  }, [])

  const subscribe = useCallback(async () => {
    if (!organizationId || !isPushSupported()) return false

    setIsRegistering(true)
    try {
      const permission = await Notification.requestPermission()
      setPermissionState(permission as PushPermissionState)

      if (permission !== 'granted') {
        return false
      }

      let reg = registrationRef.current
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        registrationRef.current = reg
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        console.error('[Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set')
        return false
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      })

      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        console.error('[Push] Invalid subscription keys')
        return false
      }

      await subscribeMutation({
        organizationId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent,
      })

      return true
    } catch (err) {
      console.error('[Push] Subscribe failed:', err)
      return false
    } finally {
      setIsRegistering(false)
    }
  }, [organizationId, subscribeMutation])

  const unsubscribe = useCallback(async () => {
    if (!organizationId || !isPushSupported()) return false

    try {
      const reg = registrationRef.current ?? (await navigator.serviceWorker.getRegistration())
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          await unsubscribeMutation({
            organizationId,
            endpoint: sub.endpoint,
          })
        }
      }
      return true
    } catch (err) {
      console.error('[Push] Unsubscribe failed:', err)
      return false
    }
  }, [organizationId, unsubscribeMutation])

  const isSubscribed = (existingSubs?.length ?? 0) > 0

  return useMemo(
    () => ({
      permissionState,
      isSubscribed,
      isRegistering,
      isSupported: isPushSupported(),
      subscribe,
      unsubscribe,
    }),
    [permissionState, isSubscribed, isRegistering, subscribe, unsubscribe]
  )
}
