import { ConvexError } from 'convex/values'

const DEV_MODE = process.env.NODE_ENV !== 'production'
const DEBUG = process.env.DEBUG_MEMORY === 'true' || DEV_MODE

/**
 * Enforce a shared server token for public Convex memory surfaces.
 *
 * In production, MEMORY_API_TOKEN must be configured and provided by trusted
 * server callers (e.g. Next.js API route). In local dev/test, auth is bypassed
 * only when DISABLE_AUTH_IN_DEV=true and MEMORY_API_TOKEN is not set.
 */
export function assertMemoryApiToken(argsToken: string | undefined, surface: string): void {
  const requiredToken = process.env.MEMORY_API_TOKEN
  const allowDevBypass = process.env.DISABLE_AUTH_IN_DEV === 'true'

  if (!requiredToken || requiredToken.trim().length === 0) {
    if (!DEV_MODE) {
      throw new ConvexError({
        code: 'CONFIGURATION_ERROR',
        message: 'MEMORY_API_TOKEN is required in production.',
      })
    }

    if (!allowDevBypass) {
      throw new ConvexError({
        code: 'CONFIGURATION_ERROR',
        message: 'MEMORY_API_TOKEN is required unless DISABLE_AUTH_IN_DEV=true in non-production.',
      })
    }

    if (DEBUG) {
      console.warn(
        '[Memory:Security] MEMORY_API_TOKEN not set; allowing unsecured dev access because DISABLE_AUTH_IN_DEV=true',
        {
          surface,
        }
      )
    }
    return
  }

  if (argsToken !== requiredToken) {
    throw new ConvexError({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized memory API access.',
    })
  }
}
