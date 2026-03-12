'use client'

import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { ConvexReactClient } from 'convex/react'
import { type ReactNode, useMemo } from 'react'
import { Toaster } from 'sonner'
import { HeaderProvider } from '@/contexts'
import { authClient } from '@/lib/auth/client'

/**
 * Convex Providers with Better Auth integration
 *
 * Optimizations:
 * - unsavedChangesWarning disabled for better UX
 * - initialToken support for faster client authentication
 * - Proper error handling for missing configuration
 */
export function Providers({
  children,
  initialToken,
}: {
  children: ReactNode
  initialToken?: string | null
}) {
  const convex = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL
    if (!url) {
      return null
    }
    return new ConvexReactClient(url, {
      unsavedChangesWarning: false, // Disable warnings for better UX
    })
  }, [])

  if (!convex) {
    return (
      <HeaderProvider>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className: 'bg-surface-tertiary border-border text-text-primary',
          }}
          richColors
          closeButton
        />
      </HeaderProvider>
    )
  }

  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient} initialToken={initialToken}>
      <HeaderProvider>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className: 'bg-surface-tertiary border-border text-text-primary',
          }}
          richColors
          closeButton
        />
      </HeaderProvider>
    </ConvexBetterAuthProvider>
  )
}
