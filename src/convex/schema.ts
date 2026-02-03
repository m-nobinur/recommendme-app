import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // ============================================
  // MULTI-TENANT: Organizations
  // ============================================
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
    settings: v.optional(
      v.object({
        defaultAiProvider: v.optional(v.string()),
        modelTier: v.optional(v.string()),
      })
    ),
  }).index('by_slug', ['slug']),

  // ============================================
  // AUTHENTICATION: Application Users
  // ============================================
  // Note: Better Auth Component manages its own user/session tables in components.betterAuth
  // This table stores application-specific user data (organization, role, settings)
  appUsers: defineTable({
    authUserId: v.string(), // Links to Better Auth user ID
    organizationId: v.id('organizations'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
    settings: v.optional(
      v.object({
        aiProvider: v.optional(v.string()),
        modelTier: v.optional(v.string()),
        theme: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_auth_user', ['authUserId'])
    .index('by_org', ['organizationId']),

  // ============================================
  // CRM: Leads
  // ============================================
  leads: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    status: v.union(
      v.literal('New'),
      v.literal('Contacted'),
      v.literal('Qualified'),
      v.literal('Proposal'),
      v.literal('Booked'),
      v.literal('Closed')
    ),
    notes: v.optional(v.string()),
    tags: v.array(v.string()),
    value: v.optional(v.number()),
    createdAt: v.number(),
    createdBy: v.id('appUsers'),
    updatedAt: v.number(),
    lastContact: v.optional(v.number()),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_org_created', ['organizationId', 'createdAt'])
    .searchIndex('search_leads', {
      searchField: 'name',
      filterFields: ['organizationId', 'status'],
    }),

  // ============================================
  // CRM: Appointments
  // ============================================
  appointments: defineTable({
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
    leadName: v.string(),
    date: v.string(), // YYYY-MM-DD
    time: v.string(), // HH:MM
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.union(v.literal('scheduled'), v.literal('completed'), v.literal('cancelled')),
    createdAt: v.number(),
    createdBy: v.id('appUsers'),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_lead', ['leadId'])
    .index('by_org_date', ['organizationId', 'date'])
    .index('by_org_status', ['organizationId', 'status']),

  // ============================================
  // CRM: Invoices
  // ============================================
  invoices: defineTable({
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
    leadName: v.string(),
    amount: v.number(),
    status: v.union(v.literal('draft'), v.literal('sent'), v.literal('paid')),
    description: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          name: v.string(),
          quantity: v.number(),
          price: v.number(),
        })
      )
    ),
    createdAt: v.number(),
    createdBy: v.id('appUsers'),
    updatedAt: v.number(),
    dueDate: v.optional(v.string()),
    paidAt: v.optional(v.number()),
  })
    .index('by_org', ['organizationId'])
    .index('by_lead', ['leadId'])
    .index('by_org_status', ['organizationId', 'status']),

  // ============================================
  // CHAT: Messages
  // ============================================
  messages: defineTable({
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    conversationId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          args: v.any(),
          result: v.optional(v.string()),
        })
      )
    ),
    metadata: v.optional(
      v.object({
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
        tokenCount: v.optional(v.number()),
        latencyMs: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
  })
    .index('by_conversation', ['conversationId', 'createdAt'])
    .index('by_user', ['userId', 'createdAt'])
    .index('by_org', ['organizationId', 'createdAt']),

  // ============================================
  // MEMORY: Agent Memory (mem0 backup)
  // ============================================
  memories: defineTable({
    organizationId: v.id('organizations'),
    userId: v.optional(v.id('appUsers')),
    scope: v.union(v.literal('user'), v.literal('organization')),
    type: v.union(
      v.literal('fact'),
      v.literal('preference'),
      v.literal('context'),
      v.literal('instruction')
    ),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())),
    metadata: v.optional(v.any()),
    source: v.optional(v.string()), // "mem0" or "convex"
    externalId: v.optional(v.string()), // mem0 memory ID
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_user', ['userId'])
    .index('by_org_scope', ['organizationId', 'scope'])
    .index('by_external_id', ['externalId']),
})
