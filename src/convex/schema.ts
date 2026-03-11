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
        budgetTier: v.optional(
          v.union(
            v.literal('free'),
            v.literal('starter'),
            v.literal('pro'),
            v.literal('enterprise')
          )
        ),
        nicheId: v.optional(v.string()),
        timezone: v.optional(v.string()),
      })
    ),
  })
    .index('by_slug', ['slug'])
    .index('by_created', ['createdAt']),

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
        retrievalTrace: v.optional(
          v.object({
            memories: v.array(
              v.object({
                id: v.string(),
                content: v.string(),
                type: v.string(),
                layer: v.union(
                  v.literal('platform'),
                  v.literal('niche'),
                  v.literal('business'),
                  v.literal('agent')
                ),
                score: v.number(),
                included: v.boolean(),
              })
            ),
            tokenBudget: v.number(),
            tokensUsed: v.number(),
          })
        ),
      })
    ),
    createdAt: v.number(),
  })
    .index('by_conversation', ['conversationId', 'createdAt'])
    .index('by_user', ['userId', 'createdAt'])
    .index('by_org', ['organizationId', 'createdAt'])
    .index('by_org_conversation', ['organizationId', 'conversationId'])
    .index('by_org_conversation_message', ['organizationId', 'conversationId', 'messageId']),

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
    .index('by_org_active', ['organizationId', 'isActive'])
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
    idempotencyKey: v.optional(v.string()),
    data: v.union(
      v.object({
        type: v.literal('conversation_end'),
        conversationId: v.string(),
        messageCount: v.number(),
        lastUserMessage: v.optional(v.string()),
        finishReason: v.string(),
        latencyMs: v.optional(v.number()),
        needsArchival: v.optional(v.boolean()),
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
        agentType: v.optional(v.string()),
        approverUserId: v.optional(v.string()),
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
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('processing'),
        v.literal('processed'),
        v.literal('failed')
      )
    ),
    retryCount: v.optional(v.number()),
    processingStartedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    processedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_org_unprocessed', ['organizationId', 'processed'])
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_org_status_created', ['organizationId', 'status', 'createdAt'])
    .index('by_org_type_processed_created', [
      'organizationId',
      'eventType',
      'processed',
      'createdAt',
    ])
    .index('by_org_idempotency', ['organizationId', 'idempotencyKey'])
    .index('by_type', ['eventType', 'processed'])
    .index('by_status_created', ['status', 'createdAt'])
    .index('by_status_processing_started', ['status', 'processingStartedAt'])
    .index('by_created', ['createdAt']),

  // ============================================
  // AGENT FRAMEWORK: Definitions
  // Per-org agent configuration and enablement
  // ============================================
  agentDefinitions: defineTable({
    organizationId: v.id('organizations'),
    agentType: v.string(),
    enabled: v.boolean(),
    triggerType: v.union(v.literal('cron'), v.literal('event'), v.literal('manual')),
    riskLevel: v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
    settings: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_agent', ['organizationId', 'agentType'])
    .index('by_org_enabled', ['organizationId', 'enabled'])
    .index('by_agent_enabled', ['agentType', 'enabled']),

  // ============================================
  // AGENT FRAMEWORK: Executions
  // Tracks each agent run lifecycle
  // ============================================
  agentExecutions: defineTable({
    organizationId: v.id('organizations'),
    agentType: v.string(),
    triggerType: v.string(),
    triggerId: v.optional(v.string()),
    status: v.union(
      v.literal('pending'),
      v.literal('loading_context'),
      v.literal('planning'),
      v.literal('risk_assessing'),
      v.literal('executing'),
      v.literal('awaiting_approval'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('skipped')
    ),
    plan: v.optional(v.any()),
    results: v.optional(v.any()),
    actionsPlanned: v.optional(v.number()),
    actionsExecuted: v.optional(v.number()),
    actionsSkipped: v.optional(v.number()),
    memoryContext: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_agent', ['organizationId', 'agentType'])
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_org_agent_status', ['organizationId', 'agentType', 'status'])
    .index('by_created', ['createdAt']),

  // ============================================
  // AGENT FRAMEWORK: Execution Locks
  // Prevent duplicate concurrent executions per org+agent
  // ============================================
  agentExecutionLocks: defineTable({
    organizationId: v.id('organizations'),
    agentType: v.string(),
    executionId: v.id('agentExecutions'),
    acquiredAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_org_agent', ['organizationId', 'agentType'])
    .index('by_expires', ['expiresAt']),

  // ============================================
  // GUARDRAILS: Approval Queue
  // Human-in-the-loop review for high-risk agent actions
  // ============================================
  approvalQueue: defineTable({
    organizationId: v.id('organizations'),
    executionId: v.optional(v.id('agentExecutions')),
    agentType: v.string(),
    action: v.string(),
    target: v.optional(v.string()),
    actionParams: v.any(),
    riskLevel: v.union(
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
      v.literal('critical')
    ),
    context: v.optional(v.string()),
    description: v.string(),
    expiresAt: v.number(),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('expired')
    ),
    reviewedBy: v.optional(v.id('appUsers')),
    reviewedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    executionClaimedAt: v.optional(v.number()),
    executionProcessedAt: v.optional(v.number()),
    executionRetryCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_status_expires', ['organizationId', 'status', 'expiresAt'])
    .index('by_org_status_created', ['organizationId', 'status', 'createdAt'])
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_execution', ['executionId'])
    .index('by_status_expires', ['status', 'expiresAt']),

  // ============================================
  // GUARDRAILS: Audit Logs
  // Append-only log of all agent/system/user actions
  // ============================================
  auditLogs: defineTable({
    organizationId: v.id('organizations'),
    userId: v.optional(v.id('appUsers')),
    actorType: v.union(v.literal('system'), v.literal('user'), v.literal('agent')),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    details: v.any(),
    riskLevel: v.union(
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
      v.literal('critical')
    ),
    traceId: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_org_action_created', ['organizationId', 'action', 'createdAt'])
    .index('by_org_risk_created', ['organizationId', 'riskLevel', 'createdAt']),

  securityRateLimits: defineTable({
    key: v.string(),
    scope: v.union(
      v.literal('chat_request'),
      v.literal('approval_review'),
      v.literal('feedback_submit')
    ),
    organizationId: v.optional(v.id('organizations')),
    userId: v.optional(v.id('appUsers')),
    ipAddress: v.optional(v.string()),
    count: v.number(),
    resetAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_reset', ['resetAt'])
    .index('by_scope_reset', ['scope', 'resetAt'])
    .index('by_org_scope_reset', ['organizationId', 'scope', 'resetAt']),

  // ============================================
  // OBSERVABILITY: Distributed Traces
  // Span-level data for request lifecycle tracking
  // ============================================
  traces: defineTable({
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    organizationId: v.optional(v.id('organizations')),
    operationName: v.string(),
    spanType: v.union(
      v.literal('api'),
      v.literal('llm'),
      v.literal('retrieval'),
      v.literal('tool'),
      v.literal('agent'),
      v.literal('internal')
    ),
    status: v.union(v.literal('ok'), v.literal('error')),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    attributes: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index('by_trace', ['traceId'])
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_org_trace_created', ['organizationId', 'traceId', 'createdAt'])
    .index('by_org_trace_start', ['organizationId', 'traceId', 'startTime'])
    .index('by_org_span_type_created', ['organizationId', 'spanType', 'createdAt'])
    .index('by_span_type_created', ['spanType', 'createdAt'])
    .index('by_created', ['createdAt']),

  // ============================================
  // OBSERVABILITY: LLM Usage Tracking
  // Per-call cost and token accounting
  // ============================================
  llmUsage: defineTable({
    organizationId: v.id('organizations'),
    traceId: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    estimatedCostUsd: v.float64(),
    purpose: v.union(
      v.literal('chat'),
      v.literal('extraction'),
      v.literal('embedding'),
      v.literal('agent'),
      v.literal('summary'),
      v.literal('compression')
    ),
    cached: v.boolean(),
    latencyMs: v.number(),
    createdAt: v.number(),
  })
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_org_purpose_created', ['organizationId', 'purpose', 'createdAt'])
    .index('by_org_model_created', ['organizationId', 'model', 'createdAt'])
    .index('by_created', ['createdAt']),

  // ============================================
  // LEARNING: Detected Patterns (Phase 11.2)
  // Tracks recurring behavioural patterns per org
  // ============================================
  detectedPatterns: defineTable({
    organizationId: v.id('organizations'),
    patternType: v.union(
      v.literal('time_preference'),
      v.literal('communication_style'),
      v.literal('decision_speed'),
      v.literal('price_sensitivity'),
      v.literal('channel_preference')
    ),
    description: v.string(),
    confidence: v.float64(),
    occurrenceCount: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    autoLearned: v.boolean(),
    evidence: v.array(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_type', ['organizationId', 'patternType'])
    .index('by_org_active', ['organizationId', 'isActive']),

  // ============================================
  // LEARNING: Quality Snapshots (Phase 11.4)
  // Periodic memory quality metric snapshots
  // ============================================
  qualitySnapshots: defineTable({
    organizationId: v.id('organizations'),
    overallScore: v.float64(),
    metrics: v.array(
      v.object({
        name: v.string(),
        value: v.float64(),
        previousValue: v.float64(),
        delta: v.float64(),
        timestamp: v.number(),
      })
    ),
    alerts: v.array(
      v.object({
        metric: v.string(),
        currentValue: v.float64(),
        previousValue: v.float64(),
        dropPercent: v.float64(),
        timestamp: v.number(),
      })
    ),
    alertTriggered: v.boolean(),
    alertReason: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_org_created', ['organizationId', 'createdAt']),

  // ============================================
  // ANALYTICS: Daily Pre-computed Snapshots (Phase 8.8)
  // Stores daily org-level analytics for fast dashboard reads
  // ============================================
  dailyAnalytics: defineTable({
    organizationId: v.id('organizations'),
    date: v.string(), // YYYY-MM-DD
    leads: v.object({
      total: v.number(),
      byStatus: v.any(),
      totalValue: v.number(),
    }),
    appointments: v.object({
      total: v.number(),
      byStatus: v.any(),
    }),
    invoices: v.object({
      total: v.number(),
      byStatus: v.any(),
      totalRevenue: v.number(),
      paidRevenue: v.number(),
    }),
    memory: v.object({
      totalActive: v.number(),
      totalArchived: v.number(),
      byType: v.any(),
      avgDecayScore: v.number(),
    }),
    aiUsage: v.object({
      callCount: v.number(),
      totalTokens: v.number(),
      totalCostUsd: v.float64(),
      byPurpose: v.any(),
    }),
    agents: v.object({
      totalExecutions: v.number(),
      byAgent: v.any(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_date', ['organizationId', 'date'])
    .index('by_org_created', ['organizationId', 'createdAt']),

  // ============================================
  // COMMUNICATION: Outbound Message Queue (Phase 8.7)
  // Queue for agent-generated communications (email/SMS/in-app)
  // Delivery adapters pluggable: Resend (email), Twilio (SMS), in-app
  // ============================================
  communicationQueue: defineTable({
    organizationId: v.id('organizations'),
    channel: v.union(v.literal('email'), v.literal('sms'), v.literal('in_app')),
    status: v.union(
      v.literal('pending'),
      v.literal('sending'),
      v.literal('sent'),
      v.literal('failed'),
      v.literal('skipped')
    ),
    recipientType: v.union(v.literal('lead'), v.literal('user')),
    recipientId: v.string(),
    recipientAddress: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.string(),
    sourceType: v.union(
      v.literal('agent_followup'),
      v.literal('agent_reminder'),
      v.literal('agent_invoice'),
      v.literal('agent_sales'),
      v.literal('system')
    ),
    sourceExecutionId: v.optional(v.id('agentExecutions')),
    priority: v.union(v.literal('low'), v.literal('normal'), v.literal('high')),
    scheduledAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    retryCount: v.number(),
    maxRetries: v.number(),
    externalMessageId: v.optional(v.string()),
    deliveryStatus: v.optional(
      v.union(
        v.literal('sent'),
        v.literal('delivered'),
        v.literal('delivery_delayed'),
        v.literal('bounced'),
        v.literal('complained')
      )
    ),
    deliveryUpdatedAt: v.optional(v.number()),
    templateName: v.optional(v.string()),
    templateProps: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_status_scheduled', ['status', 'scheduledAt'])
    .index('by_external_id', ['externalMessageId']),

  memoryEventDeadLetters: defineTable({
    organizationId: v.id('organizations'),
    eventId: v.id('memoryEvents'),
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
    data: v.any(),
    retryCount: v.number(),
    error: v.string(),
    failedAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_org_created', ['organizationId', 'createdAt'])
    .index('by_event', ['eventId']),
})
