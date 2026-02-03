import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

/**
 * Better Auth Configuration
 *
 * This configures Better Auth as the authentication provider for Convex.
 * The provider handles JWT validation and user authentication.
 */
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
