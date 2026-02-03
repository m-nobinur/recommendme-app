import { type AuthFunctions, createClient, type GenericCtx } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { betterAuth } from 'better-auth/minimal'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { query } from './_generated/server'
import authConfig from './auth.config'

const siteUrl = process.env.SITE_URL || 'http://localhost:3000'

/**
 * Reference to internal trigger mutation functions
 * Required by Better Auth trigger system
 */
const authFunctions: AuthFunctions = internal.auth

/**
 * The component client provides methods for integrating Convex with Better Auth,
 * with transactional triggers for automatic appUser synchronization.
 *
 * Triggers ensure:
 * - Atomic operations: appUser creation happens in the same transaction as auth user creation
 * - Data integrity: Impossible to have orphaned users
 * - Automatic sync: No client-side coordination required
 * - Cascade delete: Automatic cleanup when users are deleted
 */
export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  verbose: true,
  triggers: {
    user: {
      /**
       * onCreate Trigger - Automatically create appUser when auth user is created
       * Runs in the same transaction as user signup
       */
      onCreate: async (ctx, authUser) => {
        console.log('[Auth Trigger] Creating appUser for new user:', authUser.email)

        // Get or create default organization for new users
        let defaultOrg = await ctx.db
          .query('organizations')
          .filter((q) => q.eq(q.field('slug'), 'default'))
          .first()

        if (!defaultOrg) {
          console.log('[Auth Trigger] Creating default organization')
          const orgId = await ctx.db.insert('organizations', {
            name: 'Default Organization',
            slug: 'default',
            createdAt: Date.now(),
          })
          defaultOrg = await ctx.db.get(orgId)
        }

        if (!defaultOrg) {
          throw new Error('Failed to create or get default organization')
        }

        // Create appUser atomically with auth user
        const appUserId = await ctx.db.insert('appUsers', {
          authUserId: authUser._id,
          organizationId: defaultOrg._id,
          role: 'owner', // First user in an org is owner
          settings: {
            aiProvider: 'openrouter',
            modelTier: 'smart',
            theme: 'dark',
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })

        console.log('[Auth Trigger] Created appUser:', appUserId)
      },

      /**
       * onUpdate Trigger - Sync changes when auth user is updated
       * Runs in the same transaction as user update
       */
      onUpdate: async (ctx, newUser, _oldUser) => {
        console.log('[Auth Trigger] User updated:', newUser.email)

        // Find the corresponding appUser
        const appUser = await ctx.db
          .query('appUsers')
          .withIndex('by_auth_user', (q) => q.eq('authUserId', newUser._id))
          .first()

        if (appUser) {
          // Update timestamp to track when auth user was last modified
          await ctx.db.patch(appUser._id, {
            updatedAt: Date.now(),
          })
          console.log('[Auth Trigger] Updated appUser:', appUser._id)
        } else {
          console.warn('[Auth Trigger] AppUser not found for user:', newUser._id)
        }
      },

      /**
       * onDelete Trigger - Cascade delete appUser when auth user is deleted
       * Runs in the same transaction as user deletion
       */
      onDelete: async (ctx, user) => {
        console.log('[Auth Trigger] Deleting appUser for user:', user.email)

        // Find and delete the corresponding appUser
        const appUser = await ctx.db
          .query('appUsers')
          .withIndex('by_auth_user', (q) => q.eq('authUserId', user._id))
          .first()

        if (appUser) {
          await ctx.db.delete(appUser._id)
          console.log('[Auth Trigger] Deleted appUser:', appUser._id)
        } else {
          console.warn('[Auth Trigger] AppUser not found for deletion:', user._id)
        }
      },
    },
  },
})

/**
 * Export trigger API functions
 * These are required by the authFunctions reference for internal trigger execution
 */
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi()

/**
 * Create a Better Auth instance with Convex integration
 * This should be called with the Convex context to ensure proper database access
 *
 * Security Features:
 * - CSRF protection enabled (default)
 * - Secure cookies enforced in production
 * - Rate limiting to prevent brute force attacks
 * - Password constraints (8-128 characters)
 * - Session security with httpOnly cookies
 * - IP tracking for security audits
 *
 * Optimizations:
 * - Cookie caching for 5 minutes reduces database load
 * - Session refresh every 24 hours maintains active sessions
 * - 7-day session expiration balances security and UX
 */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const isProduction = process.env.NODE_ENV === 'production'

  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),

    // Email/Password Authentication Configuration
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // TODO: Enable in production
      minPasswordLength: 8,
      maxPasswordLength: 128, // Prevent DOS attacks with extremely long passwords
      autoSignIn: true, // Sign in user after successful registration
    },

    // Session Security
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days - total session lifetime
      updateAge: 60 * 60 * 24, // 24 hours - refresh session expiry every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes - cache session in cookie to reduce DB queries
      },
    },

    // Rate Limiting - Prevent brute force attacks
    rateLimit: {
      enabled: true,
      window: 60, // 1 minute window
      max: 10, // Maximum 10 requests per window per IP
      storage: 'database', // Store rate limits in database for distributed systems
    },

    // Advanced Security Settings
    advanced: {
      // Use secure cookies in production (HTTPS only)
      useSecureCookies: isProduction,

      // CSRF Protection - Enabled by default, explicitly set for clarity
      disableCSRFCheck: false,

      // Origin Check - Validates request origin
      disableOriginCheck: false,

      // Default cookie attributes for security
      defaultCookieAttributes: {
        httpOnly: true, // Prevent XSS attacks
        secure: isProduction, // HTTPS only in production
        sameSite: 'lax', // CSRF protection
        path: '/', // Cookie scope
      },

      // Track IP addresses for security audits
      ipAddress: {
        disableIpTracking: false,
        // Trust proxy headers (configure based on your infrastructure)
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      },

      // Cookie prefix removed to match middleware expectations
      // Cookies will use default Better Auth naming: better-auth.session_token
      // cookiePrefix: "recommendme",
    },

    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({ authConfig }),
    ],
  })
}

/**
 * Get the current authenticated user
 * Use this in your Convex queries/mutations to check authentication
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx)
  },
})

/**
 * Export type for use in other files
 */
export type Auth = ReturnType<typeof createAuth>
