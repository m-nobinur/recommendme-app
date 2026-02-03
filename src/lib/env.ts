import { z } from 'zod'

/**
 * Environment variable validation schema
 *
 * Server-side variables are only available on the server.
 * Client-side variables (NEXT_PUBLIC_*) are available everywhere.
 */

// Server-side environment variables
const serverEnvSchema = z.object({
  CONVEX_DEPLOYMENT: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url().optional(),

  DISABLE_AUTH_IN_DEV: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  OPENROUTER_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const clientEnvSchema = z.object({
  NEXT_PUBLIC_CONVEX_URL: z.url('NEXT_PUBLIC_CONVEX_URL must be a valid URL'),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>
export type ClientEnv = z.infer<typeof clientEnvSchema>
export type Env = ServerEnv & ClientEnv

/**
 * Validate server-side environment variables
 * Call this in server components or API routes
 */
export function validateServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env)

  if (!result.success) {
    const tree = z.treeifyError(result.error)
    const errors = tree.properties || {}
    const errorMessages = Object.entries(errors)
      .map(([key, value]) => `  ${key}: ${value?.errors?.join(', ') || 'Invalid'}`)
      .join('\n')

    console.error(`Invalid server environment variables:\n${errorMessages}`)

    if (process.env.NODE_ENV === 'development') {
      throw new Error(`Invalid server environment variables:\n${errorMessages}`)
    }
  }

  return result.data ?? ({} as ServerEnv)
}

/**
 * Validate client-side environment variables
 * Safe to call anywhere as these are public
 */
export function validateClientEnv(): ClientEnv {
  const clientEnv = {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }

  const result = clientEnvSchema.safeParse(clientEnv)

  if (!result.success) {
    const tree = z.treeifyError(result.error)
    const errors = tree.properties || {}
    const errorMessages = Object.entries(errors)
      .map(([key, value]) => `  ${key}: ${value?.errors?.join(', ') || 'Invalid'}`)
      .join('\n')

    console.error(`Invalid client environment variables:\n${errorMessages}`)
  }

  return result.data ?? ({} as ClientEnv)
}

/**
 * Get validated environment variable (server-side)
 * Returns undefined if validation fails instead of throwing
 */
export function getEnv<K extends keyof Env>(key: K): Env[K] | undefined {
  return process.env[key] as Env[K] | undefined
}

/**
 * Check if required AI provider is configured
 */
export function hasAIProvider(): boolean {
  return !!(process.env.OPENROUTER_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
}

/**
 * Check if Convex is configured
 */
export function hasConvex(): boolean {
  return !!process.env.NEXT_PUBLIC_CONVEX_URL
}

/**
 * Check if auth is properly configured
 */
export function hasAuth(): boolean {
  return !!process.env.BETTER_AUTH_SECRET
}

/**
 * Check if auth is disabled for development
 * WARNING: Only use this in development mode!
 */
export function isAuthDisabledInDev(): boolean {
  const isDev = process.env.NODE_ENV === 'development'
  const isDisabled = process.env.DISABLE_AUTH_IN_DEV === 'true'

  if (isDisabled && !isDev) {
    console.warn(
      '⚠️  WARNING: DISABLE_AUTH_IN_DEV is enabled in production! This is a security risk.'
    )
  }

  return isDev && isDisabled
}
