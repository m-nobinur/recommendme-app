import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * RecommendMe Database Schema
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    UNIFIED MEMORY ARCHITECTURE                          │
 * │                                                                         │
 * │  4-Layer Hierarchy (most general -> most specific):                     │
 * │                                                                         │
 * │  ┌──────────────────────────────────────────────────────────────────┐   │
 * │  │ Layer 1: PLATFORM MEMORIES (global, admin-only writes)           │   │
 * │  │   "Always confirm appointment details before hanging up"         │   │
 * │  │   Scope: ALL tenants   |  Vector: unfiltered                     │   │
 * │  ├──────────────────────────────────────────────────────────────────┤   │
 * │  │ Layer 2: NICHE MEMORIES (per industry vertical)                  │   │
 * │  │   "Photography clients prefer Saturday morning shoots"           │   │
 * │  │   Scope: by nicheId    |  Vector: filtered by nicheId            │   │
 * │  ├──────────────────────────────────────────────────────────────────┤   │
 * │  │ Layer 3: BUSINESS MEMORIES (per organization, tenant-isolated)   │   │
 * │  │   "Client Sarah prefers email over phone calls"                  │   │
 * │  │   Scope: by orgId      |  Vector: filtered by organizationId     │   │
 * │  ├──────────────────────────────────────────────────────────────────┤   │
 * │  │ Layer 4: AGENT MEMORIES (per agent type per org)                 │   │
 * │  │   "Follow-up agent: sending reminders at 9am gets best replies"  │   │
 * │  │   Scope: by orgId+agent|  Vector: filtered by organizationId     │   │
 * │  └──────────────────────────────────────────────────────────────────┘   │
 * │                                                                         │
 * │  Supporting Tables:                                                     │
 * │  - memoryRelations: Knowledge graph edges between entities              │
 * │  - memoryEvents:    Async pipeline trigger queue                        │
 * │                                                                         │
 * │  Data Flow:                                                             │
 * │  Chat Message -> memoryEvent -> Extraction Pipeline -> businessMemory   │
 * │                                                    -> memoryRelation    │
 * │                                                    -> agentMemory       │
 * │                                                                         │
 * │  Retrieval Flow:                                                        │
 * │  User Query -> Embedding -> Vector Search (all 4 layers in parallel)    │
 * │            -> Scoring & Ranking -> Token Budget -> System Prompt        │
 * │                                                                         │
 * │  Tenant Isolation:                                                      │
 * │  - Layers 1-2: Shared (read-only for tenants)                           │
 * │  - Layers 3-4: Strict organizationId filtering on ALL operations        │
 * │  - Relations & Events: Strict organizationId filtering                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Table Relationships:
 *
 *   organizations ─┬─> appUsers
 *                  ├─> leads ──────> appointments
 *                  │              └─> invoices
 *                  ├─> messages
 *                  ├─> businessMemories ──> previousVersionId (self-ref)
 *                  ├─> agentMemories
 *                  ├─> memoryRelations
 *                  └─> memoryEvents
 *
 *   platformMemories (no org - global)
 *   nicheMemories    (no org - shared by nicheId)
 */

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
        nicheId: v.optional(v.string()),
      })
    ),
  }).index('by_slug', ['slug']),

  // ============================================
  // AUTHENTICATION: Application Users (Managed by Better Auth Component)
  // ============================================
  appUsers: defineTable({
    authUserId: v.string(),
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

  // CRM: Leads
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
    messageId: v.optional(v.string()),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          args: v.string(),
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
        finishReason: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
  })
    .index('by_conversation', ['conversationId', 'createdAt'])
    .index('by_user', ['userId', 'createdAt'])
    .index('by_org', ['organizationId', 'createdAt'])
    .index('by_org_conversation', ['organizationId', 'conversationId']),

  // ============================================
  // MEMORY LAYER 1: Platform Memory
  // Admin managed, read-only for tenants
  platformMemories: defineTable({
    category: v.union(
      v.literal('sales'),
      v.literal('scheduling'),
      v.literal('pricing'),
      v.literal('communication'),
      v.literal('followup')
    ),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())), // 3072 dims, optional until generated
    confidence: v.float64(),
    sourceCount: v.number(),
    validatedAt: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_category', ['category'])
    .index('by_active', ['isActive'])
    .index('by_active_category', ['isActive', 'category'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 3072,
      filterFields: ['isActive'],
    }),

  // ============================================
  // MEMORY LAYER 2: Niche Memory
  // Shared within industry vertical
  // Industry terminology, patterns, pricing norms
  nicheMemories: defineTable({
    nicheId: v.string(),
    category: v.string(),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())), // 3072 dims
    confidence: v.float64(),
    contributorCount: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_niche', ['nicheId'])
    .index('by_niche_category', ['nicheId', 'category'])
    .index('by_niche_active', ['nicheId', 'isActive'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 3072,
      filterFields: ['nicheId'],
    }),

  // ============================================
  // MEMORY LAYER 3: Business Memory
  // Per organization, tenant-isolated
  // Customer prefs, pricing, services, rules
  businessMemories: defineTable({
    organizationId: v.id('organizations'),
    userId: v.optional(v.string()),
    type: v.union(
      v.literal('fact'),
      v.literal('preference'),
      v.literal('instruction'),
      v.literal('context'),
      v.literal('relationship'),
      v.literal('episodic')
    ),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())), // 3072 dims
    subjectType: v.optional(v.string()), // 'lead', 'service', 'appointment', etc.
    subjectId: v.optional(v.string()), // Entity ID
    importance: v.float64(), // 0-1
    confidence: v.float64(), // 0-1
    decayScore: v.float64(), // 0-1, starts at 1.0
    accessCount: v.number(),
    lastAccessedAt: v.number(),
    source: v.union(
      v.literal('extraction'),
      v.literal('explicit'),
      v.literal('tool'),
      v.literal('system')
    ),
    sourceMessageId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    isActive: v.boolean(),
    isArchived: v.boolean(),
    version: v.number(),
    previousVersionId: v.optional(v.id('businessMemories')),
    history: v.optional(
      v.array(
        v.object({
          previousContent: v.string(),
          changedAt: v.number(),
          reason: v.optional(v.string()),
        })
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_type', ['organizationId', 'type'])
    .index('by_org_subject', ['organizationId', 'subjectType', 'subjectId'])
    .index('by_org_active', ['organizationId', 'isActive'])
    .index('by_org_decay', ['organizationId', 'decayScore'])
    .index('by_org_importance', ['organizationId', 'importance'])
    .index('by_org_archived', ['organizationId', 'isArchived'])
    .index('by_created', ['createdAt'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 3072,
      filterFields: ['organizationId'],
    }),

  // ============================================
  // MEMORY LAYER 4: Agent Memory
  // Per agent type per organization
  // Execution patterns, learned preferences
  agentMemories: defineTable({
    organizationId: v.id('organizations'),
    agentType: v.string(), // 'crm', 'followup', 'invoice', 'sales', 'reminder'
    category: v.union(
      v.literal('pattern'),
      v.literal('preference'),
      v.literal('success'),
      v.literal('failure')
    ),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())), // 3072 dims
    useCount: v.number(),
    successRate: v.float64(),
    confidence: v.float64(),
    decayScore: v.float64(),
    lastUsedAt: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_agent', ['organizationId', 'agentType'])
    .index('by_org_agent_category', ['organizationId', 'agentType', 'category'])
    .index('by_org_agent_active', ['organizationId', 'agentType', 'isActive'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 3072,
      filterFields: ['organizationId'],
    }),

  // ============================================
  // MEMORY: Relations (Knowledge Graph Edges)
  // Lightweight graph connecting entities
  //
  // Graph traversal indexes:
  //   by_source -> outbound edges: "what does X relate TO?"
  //   by_target -> inbound edges:  "what relates TO X?"
  //   by_org    -> all edges in org (for admin/cleanup)
  //
  //   [Source] ──[relationType, strength]──> [Target]
  //   (lead:Sarah) ──[prefers, 0.9]──> (service:portrait)
  // ============================================
  memoryRelations: defineTable({
    organizationId: v.id('organizations'),
    sourceType: v.string(), // 'lead', 'memory', 'service'
    sourceId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    relationType: v.union(
      v.literal('prefers'),
      v.literal('related_to'),
      v.literal('leads_to'),
      v.literal('requires'),
      v.literal('conflicts_with')
    ),
    strength: v.float64(), // 0-1
    evidence: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_source', ['organizationId', 'sourceType', 'sourceId'])
    .index('by_target', ['organizationId', 'targetType', 'targetId']),

  // ============================================
  // MEMORY: Events (Pipeline Trigger Queue)
  // Drives async memory extraction & processing
  //
  // Flow: Chat/Agent -> create(event) -> worker polls listUnprocessed
  //       -> extraction pipeline -> markProcessed / markBatchProcessed
  //
  // Indexes:
  //   by_org_unprocessed -> worker picks next batch (FIFO)
  //   by_type            -> type-specific workers
  //   by_created         -> chronological audit trail
  // ============================================
  memoryEvents: defineTable({
    organizationId: v.id('organizations'),
    eventType: v.union(
      v.literal('conversation_end'),
      v.literal('tool_success'),
      v.literal('tool_failure'),
      v.literal('user_correction'),
      v.literal('explicit_instruction'),
      v.literal('approval_granted'),
      v.literal('approval_rejected'),
      v.literal('feedback')
    ),
    sourceType: v.union(v.literal('message'), v.literal('tool_call'), v.literal('agent_action')),
    sourceId: v.string(),
    data: v.union(
      v.object({
        type: v.literal('conversation_end'),
        conversationId: v.string(),
        messageCount: v.number(),
        lastUserMessage: v.optional(v.string()),
        finishReason: v.string(),
        latencyMs: v.optional(v.number()),
      }),
      v.object({
        type: v.literal('tool_result'),
        toolName: v.string(),
        args: v.optional(v.string()),
        result: v.optional(v.string()),
        error: v.optional(v.string()),
        durationMs: v.optional(v.number()),
      }),
      v.object({
        type: v.literal('user_input'),
        content: v.string(),
        originalContent: v.optional(v.string()),
      }),
      v.object({
        type: v.literal('approval'),
        actionDescription: v.string(),
        approved: v.boolean(),
        reason: v.optional(v.string()),
      }),
      v.object({
        type: v.literal('feedback'),
        rating: v.optional(v.number()),
        comment: v.optional(v.string()),
        messageId: v.optional(v.string()),
      })
    ),
    processed: v.boolean(),
    processedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_org_unprocessed', ['organizationId', 'processed'])
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_type', ['eventType', 'processed'])
    .index('by_created', ['createdAt']),
})
