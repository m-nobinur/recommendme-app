import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation } from './_generated/server'

/**
 * Development seed script for memory layers.
 *
 * Seeds all 4 memory layers with realistic test data for a
 * photography business CRM, matching the dev organization.
 *
 * Usage:
 *   npx convex run devSeedMemories:seedAllMemories '{"organizationId":"<DEV_ORGANIZATION_ID>"}'
 *
 * Optional nicheId for niche-layer memories:
 *   npx convex run devSeedMemories:seedAllMemories '{"organizationId":"<id>","nicheId":"photography"}'
 *
 * To clean up:
 *   npx convex run devSeedMemories:cleanMemories '{"organizationId":"<DEV_ORGANIZATION_ID>"}'
 */

export const seedAllMemories = mutation({
  args: {
    organizationId: v.id('organizations'),
    nicheId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId
    const nicheId = args.nicheId ?? 'photography'
    const counts = { platform: 0, niche: 0, business: 0, agent: 0 }

    // ── Platform memories (internal — global best practices) ──
    const platformMemories = [
      {
        category: 'sales' as const,
        content:
          'Always follow up with leads within 24 hours of initial contact. Response time is the #1 predictor of conversion.',
        confidence: 0.95,
        sourceCount: 1200,
      },
      {
        category: 'scheduling' as const,
        content:
          'Double-booking prevention: always check for conflicts 30 minutes before and after any appointment.',
        confidence: 0.92,
        sourceCount: 800,
      },
      {
        category: 'pricing' as const,
        content:
          'Offering 3 pricing tiers (Good/Better/Best) increases average order value by 30% compared to single pricing.',
        confidence: 0.88,
        sourceCount: 450,
      },
      {
        category: 'communication' as const,
        content:
          'Personalized follow-up messages with the client name and specific project details have 3x higher engagement.',
        confidence: 0.91,
        sourceCount: 950,
      },
      {
        category: 'followup' as const,
        content:
          'The optimal follow-up sequence is: Day 1 (thank you), Day 3 (check-in), Day 7 (value-add), Day 14 (re-engage).',
        confidence: 0.87,
        sourceCount: 620,
      },
    ]

    for (const mem of platformMemories) {
      await ctx.runMutation(internal.platformMemories.create, mem)
      counts.platform++
    }

    // ── Niche memories (internal — photography industry) ──
    const nicheMemories = [
      {
        nicheId,
        category: 'best_practice',
        content:
          'Golden hour shoots (1 hour before sunset) produce the best natural lighting for portrait and wedding photography.',
        confidence: 0.94,
        contributorCount: 340,
      },
      {
        nicheId,
        category: 'pricing',
        content:
          'Photography package pricing: Mini sessions $150-300, Full sessions $500-1500, Wedding packages $2000-8000 (regional average).',
        confidence: 0.86,
        contributorCount: 520,
      },
      {
        nicheId,
        category: 'client_management',
        content:
          'Send a shot list questionnaire 1 week before the session. Reduces on-site decision time by 40%.',
        confidence: 0.9,
        contributorCount: 280,
      },
      {
        nicheId,
        category: 'seasonal',
        content:
          'Wedding season peaks March-October. Book holiday mini sessions by September for November-December slots.',
        confidence: 0.92,
        contributorCount: 410,
      },
    ]

    for (const mem of nicheMemories) {
      await ctx.runMutation(internal.nicheMemories.create, mem)
      counts.niche++
    }

    // ── Business memories (public — org-specific knowledge) ──
    const businessMemories = [
      {
        organizationId: orgId,
        type: 'fact' as const,
        content:
          'John Smith prefers outdoor locations for his portrait sessions, especially parks.',
        importance: 0.8,
        confidence: 0.95,
        source: 'extraction' as const,
        subjectType: 'lead',
      },
      {
        organizationId: orgId,
        type: 'preference' as const,
        content: 'Sarah Johnson always requests black and white edits for corporate headshots.',
        importance: 0.85,
        confidence: 0.9,
        source: 'explicit' as const,
        subjectType: 'lead',
      },
      {
        organizationId: orgId,
        type: 'instruction' as const,
        content:
          'For wedding inquiries, always ask about the venue, guest count, and whether they need engagement photos.',
        importance: 0.9,
        confidence: 0.95,
        source: 'explicit' as const,
      },
      {
        organizationId: orgId,
        type: 'context' as const,
        content:
          'Our studio is available Monday-Saturday, 9am-6pm. Sunday shoots require 48-hour advance booking.',
        importance: 0.75,
        confidence: 1.0,
        source: 'system' as const,
      },
      {
        organizationId: orgId,
        type: 'relationship' as const,
        content:
          'Mike Davis was referred by John Smith. They are colleagues at TechCorp and may want group portraits.',
        importance: 0.7,
        confidence: 0.85,
        source: 'extraction' as const,
        subjectType: 'lead',
      },
      {
        organizationId: orgId,
        type: 'fact' as const,
        content:
          'Our average wedding package sells for $3,500. Upsell rate for albums is 60% when shown at delivery.',
        importance: 0.85,
        confidence: 0.9,
        source: 'system' as const,
      },
      {
        organizationId: orgId,
        type: 'episodic' as const,
        content:
          'Last week, Sarah Johnson mentioned she needs updated headshots by end of February for a conference.',
        importance: 0.9,
        confidence: 0.88,
        source: 'extraction' as const,
        subjectType: 'lead',
      },
      {
        organizationId: orgId,
        type: 'preference' as const,
        content:
          'We prefer to send invoices via email with a PDF attachment, not through the portal.',
        importance: 0.6,
        confidence: 0.95,
        source: 'explicit' as const,
      },
    ]

    for (const mem of businessMemories) {
      const id = await ctx.db.insert('businessMemories', {
        ...mem,
        accessCount: 0,
        lastAccessedAt: Date.now(),
        decayScore: 1.0,
        isActive: true,
        isArchived: false,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
        tableName: 'businessMemories' as const,
        documentId: id,
        content: mem.content,
      })
      counts.business++
    }

    // ── Agent memories (public — AI behavior learning) ──
    const agentMemories = [
      {
        organizationId: orgId,
        agentType: 'chat',
        category: 'pattern' as const,
        content:
          'Users in this organization tend to ask about scheduling and pricing most frequently.',
        confidence: 0.8,
      },
      {
        organizationId: orgId,
        agentType: 'chat',
        category: 'preference' as const,
        content:
          'The primary user prefers concise responses with bullet points rather than long paragraphs.',
        confidence: 0.85,
      },
      {
        organizationId: orgId,
        agentType: 'chat',
        category: 'success' as const,
        content:
          'Suggesting available time slots directly (instead of asking the user to check calendar) improved satisfaction.',
        confidence: 0.75,
      },
      {
        organizationId: orgId,
        agentType: 'chat',
        category: 'failure' as const,
        content:
          'Long-form responses about pricing tiers were flagged as unhelpful. User wanted a simple price quote.',
        confidence: 0.7,
      },
    ]

    for (const mem of agentMemories) {
      const id = await ctx.db.insert('agentMemories', {
        ...mem,
        useCount: 0,
        successRate: mem.category === 'success' ? 0.8 : mem.category === 'failure' ? 0.2 : 0.5,
        decayScore: 1.0,
        lastUsedAt: Date.now(),
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
        tableName: 'agentMemories' as const,
        documentId: id,
        content: mem.content,
      })
      counts.agent++
    }

    console.log('✅ Seeded memories:', counts)
    return {
      success: true,
      counts,
      totalSeeded: counts.platform + counts.niche + counts.business + counts.agent,
      message:
        `Seeded ${counts.platform} platform, ${counts.niche} niche, ` +
        `${counts.business} business, ${counts.agent} agent memories.\n` +
        `NicheId: "${nicheId}" — set this in your org settings to test niche retrieval.`,
    }
  },
})

export const cleanMemories = mutation({
  args: {
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const counts = { business: 0, agent: 0 }

    // Clean business memories for this org
    const businessMems = await ctx.db
      .query('businessMemories')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()
    for (const mem of businessMems) {
      await ctx.db.delete(mem._id)
      counts.business++
    }

    // Clean agent memories for this org
    const agentMems = await ctx.db
      .query('agentMemories')
      .withIndex('by_org_agent', (q) => q.eq('organizationId', args.organizationId))
      .collect()
    for (const mem of agentMems) {
      await ctx.db.delete(mem._id)
      counts.agent++
    }

    console.log('🧹 Cleaned memories:', counts)
    return {
      success: true,
      counts,
      message:
        `Deleted ${counts.business} business and ${counts.agent} agent memories. ` +
        'Platform and niche memories are global — clear via dashboard if needed.',
    }
  },
})
