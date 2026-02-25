import type { Doc, Id } from '../_generated/dataModel'

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
