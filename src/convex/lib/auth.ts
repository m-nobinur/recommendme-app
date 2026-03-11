import type { Doc, Id } from '../_generated/dataModel'
import { authComponent } from '../auth'

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
    throw new Error('Access denied for organization')
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
    throw new Error('Unauthenticated organization access is not allowed')
  }

  const appUser = await ctx.db
    .query('appUsers')
    .withIndex('by_auth_user', (q: any) => q.eq('authUserId', authUser._id))
    .first()

  if (!appUser || appUser.organizationId !== organizationId) {
    throw new Error('Access denied for organization')
  }

  return appUser
}
