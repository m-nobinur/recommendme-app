import { api } from '@convex/_generated/api'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { isAuthDisabledInDev } from '../env'
import { fetchAuthQuery, isAuthenticated } from './index'

/**
 * Type definitions for Better Auth with Convex
 */
export interface AuthUser {
  id: string
  email: string
  name?: string
  image?: string
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
}

export interface AuthSession {
  user: AuthUser
  session: {
    id: string
    userId: string
    token: string
    expiresAt: Date
    ipAddress?: string
    userAgent?: string
    createdAt: Date
    updatedAt: Date
  }
}

/**
 * Create a mock session for development mode
 */
function createMockSession(): AuthSession {
  const now = Date.now()
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000 // 7 days

  return {
    session: {
      id: 'dev-session-id',
      userId: 'dev-user-id',
      token: 'dev-session-token',
      expiresAt: new Date(expiresAt),
      ipAddress: '127.0.0.1',
      userAgent: 'Development',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
    user: {
      id: 'dev-user-id',
      email: 'dev@example.com',
      name: 'Development User',
      emailVerified: true,
      image: undefined,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
  }
}

/**
 * Cached session getter - deduplicated per request using React.cache()
 * This ensures we only fetch the session once per request even if called multiple times
 */
export const getServerSession = cache(async (): Promise<AuthSession | null> => {
  // Check if auth is disabled in development
  if (isAuthDisabledInDev()) {
    console.log('🔓 [DEV MODE] Returning mock session')
    return createMockSession()
  }

  try {
    // Check if user is authenticated using the Convex Better Auth utility
    const authenticated = await isAuthenticated()

    if (!authenticated) {
      return null
    }

    // Fetch the current user from Convex
    const user = await fetchAuthQuery(api.auth.getCurrentUser, {})

    if (!user) {
      return null
    }

    // Map the Convex user to our session format
    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name || '',
        image: user.image || undefined,
        emailVerified: user.emailVerified || false,
        createdAt: new Date(user._creationTime),
        updatedAt: new Date(user._creationTime),
      },
      session: {
        id: user._id,
        userId: user._id,
        token: 'convex-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(user._creationTime),
        updatedAt: new Date(user._creationTime),
      },
    }
  } catch (error) {
    console.error('Failed to get session:', error)
    return null
  }
})

/**
 * Get current user with caching - returns null if not authenticated
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const session = await getServerSession()
  return session?.user ?? null
})

/**
 * Require authentication - redirects to login if not authenticated
 * Use this in Server Components and Server Actions that require auth
 */
export async function requireAuth(): Promise<AuthSession> {
  const session = await getServerSession()

  if (!session) {
    // In dev mode with auth disabled, this should never happen
    // because getServerSession returns a mock session
    if (isAuthDisabledInDev()) {
      console.warn('⚠️  [DEV MODE] requireAuth called but no mock session found - creating one')
      return createMockSession()
    }
    redirect('/login')
  }

  return session
}

/**
 * Require authentication and return user - redirects if not authenticated
 */
export async function requireUser(): Promise<AuthUser> {
  const session = await requireAuth()
  return session.user
}

/**
 * Check if user is authenticated without redirecting
 */
export const checkIsAuthenticated = cache(async (): Promise<boolean> => {
  if (isAuthDisabledInDev()) {
    return true
  }

  try {
    return await isAuthenticated()
  } catch {
    return false
  }
})

/**
 * Server Action helper to validate session in mutations
 * Throws error instead of redirecting (for use in server actions)
 */
export async function validateSession(): Promise<AuthSession> {
  const session = await getServerSession()

  if (!session) {
    throw new Error('Unauthorized: No valid session')
  }

  return session
}
