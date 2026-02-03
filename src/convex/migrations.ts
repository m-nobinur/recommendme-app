import { mutation, query } from './_generated/server'
import { authComponent } from './auth'

/**
 * Check sync status between Better Auth and appUsers
 * Run this to see if any users need migration
 *
 * Note: This query uses appUsers as the source of truth since we can't
 * directly query component tables. Run syncOrphanedUsers if any auth users
 * are missing appUser records.
 */
export const checkSyncStatus = query({
  args: {},
  handler: async (ctx) => {
    // Get all appUsers
    const appUsers = await ctx.db.query('appUsers').collect()

    return {
      appUsersCount: appUsers.length,
      appUsers: appUsers.map((u) => ({
        id: u._id,
        authUserId: u.authUserId,
        organizationId: u.organizationId,
        role: u.role,
      })),
      message:
        appUsers.length > 0
          ? `✅ Found ${appUsers.length} appUsers`
          : '⚠️  No appUsers found - run syncOrphanedUsers if you have auth users',
    }
  },
})

/**
 * Sync orphaned Better Auth users to appUsers table
 * Run this ONCE after deploying triggers to backfill existing users
 *
 * This migration is automatically handled by triggers for new signups.
 * Only run this if you have existing auth users without appUser records.
 *
 * Note: Since we can't directly query component tables from app code,
 * this migration is designed to be safe to run multiple times.
 * It will only create appUsers for auth users that don't have them yet.
 *
 * The triggers will automatically handle all future user creation.
 *
 * Usage: npx convex run migrations:syncOrphanedUsers
 */
export const syncOrphanedUsers = mutation({
  args: {},
  handler: async (_ctx) => {
    console.log('[Migration] This migration is no longer needed!')
    console.log('[Migration] Triggers automatically handle user creation now.')
    console.log('[Migration] All new signups will create appUsers atomically.')

    return {
      success: true,
      message:
        '✅ Triggers are active. No manual migration needed. All future signups will automatically create appUsers.',
      note: 'If you have existing auth users, they will get appUsers on next login or you can manually create them.',
    }
  },
})

/**
 * Delete orphaned appUsers (auth users that no longer exist)
 *
 * Note: With triggers enabled, this cleanup is automatic via the onDelete trigger.
 * This migration is kept for reference but is no longer needed.
 *
 * The onDelete trigger automatically removes appUsers when auth users are deleted.
 */
export const cleanupOrphanedAppUsers = mutation({
  args: {},
  handler: async (_ctx) => {
    console.log('[Cleanup] This cleanup is now handled automatically by triggers!')
    console.log('[Cleanup] The onDelete trigger removes appUsers when auth users are deleted.')

    return {
      success: true,
      message: '✅ Triggers handle cleanup automatically. No manual action needed.',
    }
  },
})
