/**
 * Shared organization listing helper for background workers.
 *
 * All cron workers iterate over organizations — this centralizes the
 * paginated query to avoid duplication across memoryConsolidation,
 * analyticsWorker, memoryArchival, etc.
 */

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

const ORG_PAGE_SIZE = 100

export async function listAllOrganizationIds(ctx: {
  runQuery: (...args: any[]) => Promise<any>
}): Promise<Id<'organizations'>[]> {
  const orgIds: Id<'organizations'>[] = []
  let cursor: string | null = null

  do {
    const page = await ctx.runQuery(internal.memoryDecay.listOrganizations, {
      paginationOpts: { numItems: ORG_PAGE_SIZE, cursor },
    })
    for (const org of page.page) {
      orgIds.push(org._id as Id<'organizations'>)
    }
    cursor = page.isDone ? null : page.continueCursor
  } while (cursor)

  return orgIds
}
