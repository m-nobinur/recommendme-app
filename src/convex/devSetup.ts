import { v } from 'convex/values'
import { mutation } from './_generated/server'

/**
 * Development setup script to create test data
 * Run this once to set up dev environment:
 *
 * npx convex run devSetup:createDevEnvironment
 */
export const createDevEnvironment = mutation({
  args: {
    authUserId: v.optional(v.string()), // Optional: provide Better Auth user ID to link to
  },
  handler: async (ctx, args) => {
    // Check if dev org already exists
    const existingOrgs = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'dev-org'))
      .collect()

    let orgId: any
    if (existingOrgs.length > 0) {
      orgId = existingOrgs[0]._id
      console.log('Dev organization already exists:', orgId)
    } else {
      // Create dev organization
      orgId = await ctx.db.insert('organizations', {
        name: 'Dev Organization',
        slug: 'dev-org',
        createdAt: Date.now(),
      })
      console.log('Created dev organization:', orgId)
    }

    // Only create appUser if authUserId is provided
    let userId: any = null
    if (args.authUserId) {
      const authUserId = args.authUserId // Type narrowing

      // Check if dev user already exists
      const existingUsers = await ctx.db
        .query('appUsers')
        .withIndex('by_auth_user', (q) => q.eq('authUserId', authUserId))
        .collect()

      if (existingUsers.length > 0) {
        userId = existingUsers[0]._id
        console.log('Dev user already exists:', userId)
      } else {
        // Create dev user linked to Better Auth
        userId = await ctx.db.insert('appUsers', {
          authUserId: authUserId,
          organizationId: orgId,
          role: 'admin',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        console.log('Created dev user:', userId)
      }
    } else {
      console.log('No authUserId provided - skipping user creation. Sign up via Better Auth first.')
    }

    // Create some sample leads for testing (only if we have a user)
    if (userId) {
      const sampleLeads = [
        {
          name: 'John Smith',
          email: 'john@example.com',
          phone: '+1-555-0101',
          status: 'New' as const,
          notes: 'Interested in wedding photography',
          tags: ['Wedding', 'High-Priority'],
          value: 5000,
        },
        {
          name: 'Sarah Johnson',
          email: 'sarah@example.com',
          phone: '+1-555-0102',
          status: 'Contacted' as const,
          notes: 'Corporate event photography',
          tags: ['Corporate'],
          value: 3000,
        },
        {
          name: 'Mike Davis',
          email: 'mike@example.com',
          phone: '+1-555-0103',
          status: 'Qualified' as const,
          notes: 'Portrait session',
          tags: ['Portrait'],
          value: 500,
        },
      ]

      for (const lead of sampleLeads) {
        const existing = await ctx.db
          .query('leads')
          .withIndex('by_org', (q) => q.eq('organizationId', orgId))
          .filter((q) => q.eq(q.field('name'), lead.name))
          .first()

        if (!existing) {
          await ctx.db.insert('leads', {
            ...lead,
            organizationId: orgId,
            createdBy: userId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          console.log('Created lead:', lead.name)
        }
      }
    }

    return {
      success: true,
      organizationId: orgId,
      userId: userId,
      message: userId
        ? 'Dev environment setup complete! Add these to your .env.local:\n' +
          `DEV_ORGANIZATION_ID=${orgId}\n` +
          `DEV_USER_ID=${userId}`
        : 'Dev organization created! Sign up via Better Auth, then run this again with your authUserId:\n' +
          `npx convex run devSetup:createDevEnvironment '{"authUserId": "your-auth-user-id"}'\n` +
          `DEV_ORGANIZATION_ID=${orgId}`,
    }
  },
})

/**
 * Clean up dev environment
 */
export const cleanDevEnvironment = mutation({
  args: {},
  handler: async (ctx) => {
    // Find dev org
    const devOrgs = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'dev-org'))
      .collect()

    if (devOrgs.length === 0) {
      return { success: true, message: 'No dev environment found' }
    }

    const orgId = devOrgs[0]._id

    // Delete all leads
    const leads = await ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', orgId))
      .collect()
    for (const lead of leads) {
      await ctx.db.delete(lead._id)
    }

    // Delete all users
    const users = await ctx.db
      .query('appUsers')
      .withIndex('by_org', (q) => q.eq('organizationId', orgId))
      .collect()
    for (const user of users) {
      await ctx.db.delete(user._id)
    }

    // Delete org
    await ctx.db.delete(orgId)

    return {
      success: true,
      message: 'Dev environment cleaned up',
    }
  },
})
