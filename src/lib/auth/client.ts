'use client'

import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth React client
 *
 * Provides authentication methods and hooks for client-side components:
 * - authClient.signIn.email() - Sign in with email/password
 * - authClient.signUp.email() - Sign up with email/password
 * - authClient.signOut() - Sign out current user
 * - authClient.useSession() - Hook to access current session
 *
 * Optimizations:
 * - Cookie caching reduces unnecessary session fetches
 * - Error logging for debugging authentication issues
 * - Convex plugin integration for seamless backend communication
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  plugins: [convexClient()],
  // Configure fetch with error handling
  fetchOptions: {
    onError(context) {
      // Log errors for debugging (remove in production or use proper logging service)
      if (process.env.NODE_ENV === 'development') {
        console.error('[BetterAuth Client] Request failed:', context)
      }
    },
    onSuccess(_context) {
      // Optional: Log successful auth requests in development
      if (process.env.NODE_ENV === 'development') {
        console.log('[BetterAuth Client] Request succeeded')
      }
    },
  },
})

/**
 * Sign out the current user
 * Convenience wrapper around authClient.signOut
 */
export async function signOut() {
  await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        window.location.href = '/login'
      },
    },
  })
}

// Export methods and hooks for convenience
export const useSession = authClient.useSession
export const signIn = authClient.signIn
export const signUp = authClient.signUp
