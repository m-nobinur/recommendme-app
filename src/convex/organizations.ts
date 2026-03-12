import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, mutation, query } from './_generated/server'
import { authComponent } from './auth'

const budgetTierValues = v.union(
  v.literal('free'),
  v.literal('starter'),
  v.literal('pro'),
  v.literal('enterprise')
)

function isAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.DISABLE_AUTH_IN_DEV === 'true')
  )
}

function assertOwnerOrAdmin(user: Doc<'appUsers'>) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new Error('Only organization owners/admins can manage organization settings')
  }
}

async function resolveOrganizationActor(
  ctx: {
    db: {
      query: (tableName: 'appUsers') => {
        withIndex: (
          indexName: 'by_auth_user',
          indexBuilder: (q: { eq: (field: 'authUserId', value: string) => unknown }) => unknown
        ) => {
          first: () => Promise<Doc<'appUsers'> | null>
        }
      }
    }
  },
  organizationId?: Id<'organizations'>
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
    .withIndex('by_auth_user', (q) => q.eq('authUserId', authUser._id))
    .first()
  if (!appUser) {
    throw new Error('Authenticated app user was not found')
  }
  if (organizationId && appUser.organizationId !== organizationId) {
    throw new Error('Access denied for organization')
  }
  return appUser
}

/**
 * Create a new organization
 */
export const createOrganization = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await resolveOrganizationActor(ctx as never)
    if (actor) {
      assertOwnerOrAdmin(actor)
    }

    // Check if slug is unique
    const existing = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first()

    if (existing) {
      throw new Error('Organization slug already exists')
    }

    const orgId = await ctx.db.insert('organizations', {
      name: args.name,
      slug: args.slug,
      createdAt: Date.now(),
      settings: {
        defaultAiProvider: 'openrouter',
        modelTier: 'smart',
        budgetTier: 'starter',
      },
    })

    return orgId
  },
})

/**
 * Get organization by ID
 */
export const getOrganization = query({
  args: { id: v.id('organizations') },
  handler: async (ctx, args) => {
    await resolveOrganizationActor(ctx as never, args.id)
    return await ctx.db.get(args.id)
  },
})

/**
 * Get organization by slug
 */
export const getOrganizationBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first()
    if (!org) return null
    await resolveOrganizationActor(ctx as never, org._id)
    return org
  },
})

/**
 * Update organization settings
 */
export const updateOrganizationSettings = mutation({
  args: {
    id: v.id('organizations'),
    settings: v.object({
      defaultAiProvider: v.optional(v.string()),
      modelTier: v.optional(v.string()),
      budgetTier: v.optional(budgetTierValues),
      nicheId: v.optional(v.string()),
      timezone: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const actor = await resolveOrganizationActor(ctx as never, args.id)
    if (actor) {
      assertOwnerOrAdmin(actor)
    }

    const org = await ctx.db.get(args.id)
    if (!org) {
      throw new Error('Organization not found')
    }

    await ctx.db.patch(args.id, {
      settings: {
        ...org.settings,
        ...args.settings,
      },
    })
  },
})

/**
 * Derive a URL-safe slug base from an email address.
 * Exported for testing.
 */
export function buildOrgSlugBase(email: string): string {
  const prefix = email.split('@')[0]
  let slug = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30)

  if (!slug) slug = 'workspace'
  return slug
}

function normalizeSlugHint(rawHint: string | undefined): string | undefined {
  if (!rawHint) return undefined
  const normalized = rawHint
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
  return normalized.length > 0 ? normalized : undefined
}

/**
 * Create a per-user organization during signup with a unique slug.
 * Exported for testing.
 */
export async function createOrganizationForSignup(
  ctx: { db: any },
  args: { name: string; userEmail: string; slugHint?: string }
) {
  const baseSlug = buildOrgSlugBase(args.userEmail)
  const normalizedHint = normalizeSlugHint(args.slugHint)

  let slug = normalizedHint ? `${baseSlug}-${normalizedHint}` : baseSlug
  let counter = 0
  while (true) {
    const existing = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q: any) => q.eq('slug', slug))
      .first()
    if (!existing) break
    counter++
    slug = normalizedHint ? `${baseSlug}-${normalizedHint}-${counter}` : `${baseSlug}-${counter}`
  }

  const orgId = await ctx.db.insert('organizations', {
    name: args.name,
    slug,
    createdAt: Date.now(),
    settings: {
      defaultAiProvider: 'openrouter',
      modelTier: 'smart',
      budgetTier: 'starter',
    },
  })

  return orgId
}

/**
 * Internal: Create organization for new user signup
 */
export const internalCreateOrganization = internalMutation({
  args: {
    name: v.string(),
    userEmail: v.string(),
    slugHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await createOrganizationForSignup(ctx, args)
  },
})
