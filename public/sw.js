/// Service Worker for Web Push Notifications

const APP_NAME = 'RecommendMe'
const DEFAULT_ICON = '/favicon.svg'
const DEFAULT_URL = '/chat'

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: APP_NAME, body: event.data.text() }
  }

  const options = {
    body: data.body || '',
    icon: DEFAULT_ICON,
    badge: DEFAULT_ICON,
    tag: data.category ? `${data.category}-${Date.now()}` : undefined,
    data: {
      url: data.url || DEFAULT_URL,
      category: data.category,
      severity: data.severity,
      timestamp: data.timestamp,
    },
    vibrate: [100, 50, 100],
    requireInteraction: data.severity === 'error' || data.severity === 'warning',
  }

  event.waitUntil(self.registration.showNotification(data.title || APP_NAME, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || DEFAULT_URL

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      return self.clients.openWindow(url)
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  // Re-subscribe when browser rotates push subscription keys
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true })
      .then((newSub) => {
        return fetch('/api/push/resubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldEndpoint: event.oldSubscription?.endpoint,
            newSubscription: newSub.toJSON(),
          }),
        })
      })
  )
})
