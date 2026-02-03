import { convexBetterAuthNextJs } from '@convex-dev/better-auth/nextjs'

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL

if (!convexUrl) {
  console.error('[BetterAuth] CRITICAL: NEXT_PUBLIC_CONVEX_URL is not set')
  throw new Error('NEXT_PUBLIC_CONVEX_URL environment variable is required')
}

if (!convexSiteUrl) {
  console.error('[BetterAuth] CRITICAL: NEXT_PUBLIC_CONVEX_SITE_URL is not set')
  throw new Error(
    'NEXT_PUBLIC_CONVEX_SITE_URL environment variable is required (must end in .convex.site)'
  )
}

/**
 * Better Auth Next.js server utilities
 *
 * These utilities handle authentication for Next.js:
 * - handler: HTTP route handlers for /api/auth/[...all]
 * - getToken: Extract JWT token from cookies
 * - isAuthenticated: Check if user is authenticated
 * - preloadAuthQuery: Preload authenticated queries for React Server Components
 * - fetchAuthQuery: Fetch authenticated queries
 * - fetchAuthMutation: Execute authenticated mutations
 * - fetchAuthAction: Execute authenticated actions
 *
 * Optimizations:
 * - JWT caching enabled to reduce authentication overhead
 * - 60-second tolerance for expired tokens to handle clock skew
 * - Automatic retry on authentication errors
 */
export const {
  handler,
  getToken,
  isAuthenticated,
  preloadAuthQuery,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl,
  // Optional: Enable JWT caching for faster page loads (experimental)
  jwtCache: {
    enabled: true,
    expirationToleranceSeconds: 60, // Cache JWT for 60 seconds past expiry
    isAuthError: (error) => {
      // Function to detect authentication errors for retry logic
      return error instanceof Error && error.message.includes('Unauthenticated')
    },
  },
})

// Re-export for compatibility
export { handler as auth }
