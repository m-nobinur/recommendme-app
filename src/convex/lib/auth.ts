import type { Doc, Id } from '../_generated/dataModel'
import { authComponent } from '../auth'

export const ORGANIZATION_ACCESS_DENIED_MESSAGE = 'Access denied for organization'
export const UNAUTHENTICATED_ORG_ACCESS_MESSAGE =
  'Unauthenticated organization access is not allowed'

interface OrganizationAccessError extends Error {
  code: 'ORG_ACCESS_DENIED' | 'ORG_UNAUTHENTICATED'
  metadata: {
    organizationId?: string
  }
}

function createOrganizationAccessError(
  code: OrganizationAccessError['code'],
  message: string,
  organizationId?: Id<'organizations'>
): OrganizationAccessError {
  const error = new Error(message) as OrganizationAccessError
  error.name = 'OrganizationAccessError'
  error.code = code
  error.metadata = {
    organizationId,
  }
  return error
}

export function isOrganizationAccessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    message.includes(ORGANIZATION_ACCESS_DENIED_MESSAGE) ||
    message.includes(UNAUTHENTICATED_ORG_ACCESS_MESSAGE)
  )
}

export async function assertUserInOrganization(
  ctx: {
    db: {
      get: (id: Id<'appUsers'>) => Promise<Doc<'appUsers'> | null>
    }
  },
  userId: Id<'appUsers'>,
  organizationId: Id<'organizations'>
): Promise<Doc<'appUsers'>> {
  const user = await ctx.db.get(userId)
  if (!user || user.organizationId !== organizationId) {
    throw createOrganizationAccessError(
      'ORG_ACCESS_DENIED',
      ORGANIZATION_ACCESS_DENIED_MESSAGE,
      organizationId
    )
  }

  return user
}

function isAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.DISABLE_AUTH_IN_DEV === 'true')
  )
}

export async function assertAuthenticatedUserInOrganization(
  ctx: {
    db: {
      query: (tableName: 'appUsers') => any
    }
  },
  organizationId: Id<'organizations'>
): Promise<Doc<'appUsers'> | null> {
  let authUser: { _id: string } | null = null
  try {
    authUser = await authComponent.getAuthUser(ctx as never)
  } catch {
    authUser = null
  }

  if (!authUser) {
    if (isAuthBypassEnabled()) {
      return null
    }
    throw createOrganizationAccessError(
      'ORG_UNAUTHENTICATED',
      UNAUTHENTICATED_ORG_ACCESS_MESSAGE,
      organizationId
    )
  }

  const appUser = await ctx.db
    .query('appUsers')
    .withIndex('by_auth_user', (q: any) => q.eq('authUserId', authUser._id))
    .first()

  if (!appUser || appUser.organizationId !== organizationId) {
    throw createOrganizationAccessError(
      'ORG_ACCESS_DENIED',
      ORGANIZATION_ACCESS_DENIED_MESSAGE,
      organizationId
    )
  }

  return appUser
}
