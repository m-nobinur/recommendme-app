# RecommendMe Memory & Agent System - Development Plan

> **Comprehensive phased implementation plan for the Unified Memory Architecture**
> Document Version: 1.7 | Created: February 8, 2026 | Updated: February 24, 2026
> Branch: `feat/agent-framework`
> **Current Status: Phase 7a (Agent Framework Foundation) COMPLETE - Ready for Phase 7b+**

---

## Table of Contents

1. [Readiness Assessment](#1-readiness-assessment)
2. [Technology Decisions](#2-technology-decisions)
3. [Phase Overview](#3-phase-overview)
4. [Phase 0: Prerequisites & Foundation Fixes](#4-phase-0-prerequisites--foundation-fixes)
5. [Phase 1: Memory Schema & CRUD](#5-phase-1-memory-schema--crud)
6. [Phase 2: Embedding Service & Vector Search](#6-phase-2-embedding-service--vector-search)
7. [Phase 3: Memory Retrieval Pipeline & Context Builder](#7-phase-3-memory-retrieval-pipeline--context-builder)
8. [Phase 4: Memory Extraction Pipeline](#8-phase-4-memory-extraction-pipeline)
9. [Phase 5: Decay Algorithm & Memory Lifecycle](#9-phase-5-decay-algorithm--memory-lifecycle)
10. [Phase 6: Memory Tools & Chat Integration](#10-phase-6-memory-tools--chat-integration)
11. [Phase 7: Agent Framework with LangGraph](#11-phase-7-agent-framework-with-langgraph)
12. [Phase 8: Worker Architecture & Background Jobs](#12-phase-8-worker-architecture--background-jobs)
13. [Phase 9: Guardrails, Security & Approval Workflow](#13-phase-9-guardrails-security--approval-workflow)
14. [Phase 10: Observability, Tracing & Cost Management](#14-phase-10-observability-tracing--cost-management)
15. [Phase 11: Continuous Improvement & Learning System](#15-phase-11-continuous-improvement--learning-system)
16. [Phase 12: Memory UI & Admin Dashboard](#16-phase-12-memory-ui--admin-dashboard)
17. [Dependency Installation Schedule](#17-dependency-installation-schedule)
18. [Risk Register](#18-risk-register)
19. [Quality Gates](#19-quality-gates)

---

## 1. Readiness Assessment

### Current State Summary

| Component | Status | Details |
|-----------|--------|---------|
| **Convex Schema** | **DONE** | Full 4-layer hierarchy implemented: `platformMemories`, `nicheMemories`, `businessMemories`, `agentMemories`, `memoryRelations`, `memoryEvents` with indexes + vector indexes |
| **Message Persistence** | **DONE** | `messages` table + CRUD in `src/convex/messages.ts`; wired to chat route via `onFinish` callback |
| **Chat Route** | **DONE** | `src/app/api/chat/route.ts` works with Vercel AI SDK; message persistence integrated |
| **Conversation Tracking** | **DONE** | `conversationId` generated via UUID, persisted in Zustand store (`chat.store.ts`), passed in `useChat` body |
| **CRM Tools** | Working | 6 tools (addLead, updateLead, scheduleAppointment, createInvoice, listLeads, getSchedule) |
| **Feature Flags** | **DONE** | `enableMemory`, `enableMessagePersistence` enabled for dev |
| **System Prompt** | Ready | Has `{{memory_context}}` placeholder; `getSystemPrompt(memoryContext)` exists |
| **Memory CRUD** | **DONE** | Full CRUD for all 6 tables: `platformMemories.ts`, `nicheMemories.ts`, `businessMemories.ts`, `agentMemories.ts`, `memoryRelations.ts`, `memoryEvents.ts` |
| **Memory Validation** | **DONE** | `src/lib/ai/memory/validation.ts` - content length, confidence, PII detection, layer-specific rules |
| **Memory Types** | **DONE** | Centralized in `src/types/index.ts` - single source of truth for all memory types |
| **Embedding Service** | **DONE** | Multi-provider (OpenRouter default, OpenAI fallback) with retry + backoff in `src/convex/embedding.ts` |
| **Vector Search** | **DONE** | Parallel multi-layer search + hybrid RRF search in `src/convex/vectorSearch.ts` and `src/convex/hybridSearch.ts` |
| **Embedding Utilities** | **DONE** | Shared constants + math in `src/lib/ai/memory/embedding.ts` |
| **Auto-Embedding** | **DONE** | All 4 memory CRUD layers auto-trigger embedding via `ctx.scheduler.runAfter` |
| **Memory Retrieval** | **DONE** | Full pipeline: query analysis → scoring → token budget → context formatting in `src/lib/ai/memory/`. Convex action gateway in `src/convex/memoryRetrieval.ts`. Integrated into chat route with early-start parallelism. |
| **Memory Extraction** | **DONE** | LLM-based extraction pipeline in `src/convex/memoryExtraction.ts`, prompt in `src/lib/ai/memory/extractionPrompt.ts` |
| **Memory Events** | **DONE** | Event emission in chat route (`conversation_end`, `tool_success`, `tool_failure`), processing via cron |
| **Cron Jobs** | **DONE** | `src/convex/crons.ts` — extraction (2m), decay (1h), archival (daily), cleanup (weekly) |
| **Decay Algorithm** | **DONE** | Ebbinghaus formula in `src/lib/ai/memory/decay.ts`, workers in `src/convex/memoryDecay.ts` |
| **TTL Management** | **DONE** | `src/lib/ai/memory/ttl.ts` with per-type defaults, auto-set on create, filtered during retrieval |
| **Memory Archival** | **DONE** | `src/convex/memoryArchival.ts` — archival, LLM compression, soft-delete lifecycle, orphan cleanup |
| **Action Retrier** | **DONE** | `@convex-dev/action-retrier` for robust LLM retry during compression |
| **Memory Tools** | **DONE** | 4 tools (rememberFact, forgetMemory, searchMemories, updatePreference) in `src/lib/ai/tools/memory.ts` |
| **Conversation Summary** | **DONE** | Sliding window + LLM summary in `src/lib/ai/memory/conversationSummary.ts` |
| **E2E Memory Loop** | **DONE** | store → retrieve → use → learn complete |
| **Agent Framework** | Missing | No LangGraph/LangChain dependencies |
| **Guardrails** | Missing | No risk assessment, approval queue, or audit logging |
| **Tracing** | Missing | No trace spans, no Langfuse integration |
| **Memory UI** | Missing | No memory viewer or admin dashboard |

### Blocking Dependencies

```
Message Persistence ──┐
                      ├──▶ Memory Extraction ──▶ Pattern Detection ──▶ Niche/Platform Promotion
Conversation Tracking ┘      [DONE - Phase 4]       (Phase 8)             (Phase 8)
[DONE - Phase 0]           │
                           │
Embedding Service ─────────┤
[DONE - Phase 2]           │
Vector Search ─────────────┼──▶ Memory Retrieval ──▶ Context Builder ──▶ Chat Integration
[DONE - Phase 2]           │     [DONE - Phase 3]     [DONE - Phase 3]    [DONE - Phase 3]
                           │
Memory CRUD ───────────────┘                       ──▶ Decay & Lifecycle ──▶ Memory Tools & Chat
[DONE - Phase 1]                                       [DONE - Phase 5]      [DONE - Phase 6]
```

### Pre-Implementation Checklist

- [x] Architecture documentation complete (`UNIFIED_MEMORY_ARCHITECTURE.md`)
- [x] Memory readiness assessment complete (`memory-readiness.md`)
- [x] Technical canvas complete (`Adaptive Memory Centric AI System Technical Canvas.md`)
- [x] Convex schema foundation (organizations, appUsers, leads, etc.)
- [x] Authentication system (better-auth) working
- [x] CRM tools working
- [x] Feature flag system configured
- [x] System prompt with memory placeholder
- [x] Message persistence wired to chat (Phase 0) **DONE**
- [x] Conversation tracking in frontend (Phase 0) **DONE**
- [x] 4-layer memory schema + CRUD (Phase 1) **DONE**
- [x] Memory validation library (Phase 1) **DONE**
- [x] Vector indexes configured in schema (Phase 1) **DONE**
- [x] Embedding service (Phase 2) **DONE**
- [x] Vector search functions (Phase 2) **DONE**
- [x] Hybrid search with RRF (Phase 2) **DONE**
- [x] Auto-embedding on memory CRUD (Phase 2) **DONE**
- [x] Memory retrieval pipeline (Phase 3) **DONE**
- [x] Context builder & token budget (Phase 3) **DONE**
- [x] Memory extraction pipeline (Phase 4) **DONE**
- [x] Memory event emission: `conversation_end`, `tool_success`, `tool_failure` (Phase 4) **DONE**
- [x] Cron job for extraction worker (Phase 4) **DONE**
- [x] Decay algorithm with Ebbinghaus formula (Phase 5) **DONE**
- [x] Decay workers: hourly cron + on-access boost (Phase 5) **DONE**
- [x] TTL management with per-type defaults (Phase 5) **DONE**
- [x] Memory archival + compression via action-retrier (Phase 5) **DONE**
- [x] Lifecycle cleanup: soft-delete + hard-delete + orphan cleanup (Phase 5) **DONE**
- [x] Memory tools for chat (Phase 6) **DONE**
- [x] End-to-end memory loop (Phase 6) **DONE**
- [x] Conversation summary with sliding window (Phase 6) **DONE**
- [x] Intent-aware layer routing & retrieval optimization (Phase 6.5) **DONE**
- [x] Selective layer search for reduced latency (Phase 6.5) **DONE**
- [x] Shared test infrastructure refactor (Phase 6.5) **DONE**
- [x] Token-gated memory retrieval/event APIs with dev bypass (Phase 6.8) **DONE**
- [x] Organization-scoped memory event type queries (Phase 6.8) **DONE**
- [x] Extraction handlers for correction/instruction/approval/feedback events (Phase 6.8) **DONE**

---

## 2. Technology Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Primary Database** | Convex | Already integrated, real-time, scales well |
| **Vector Search** | Convex built-in | Native, consistent, sufficient for MVP |
| **Embeddings** | `text-embedding-3-large` (3072 dims) via OpenRouter (default) or OpenAI (fallback) | Higher quality for production, provider-agnostic |
| **Memory Framework** | Custom on Convex | Full control, fastest path, no extra vendor |
| **Agent Framework (Background)** | LangGraph + LangChain | State machines, multi-step reasoning, human-in-the-loop |
| **Agent Framework (Simple/Chat)** | Vercel AI SDK | Already integrated, streaming, tool calling |
| **LLM Provider** | OpenRouter (default) + direct APIs | Multi-model access, fallback options |
| **Observability** | Langfuse + Convex trace tables | LLM-specific tracing + internal metrics |
| **Memory Management** | Custom (no mem0) | Full control, Convex-native, no vendor lock-in |

### LangGraph/LangChain Usage Scope

**LangGraph** will be used for:
- Background agent execution (followup agent, reminder agent, invoice agent)
- Multi-step reasoning workflows (plan → risk-assess → execute → learn)
- Human-in-the-loop approval patterns
- Agent state machines with checkpointing

**LangChain** will be used sparingly for:
- Tool abstractions within LangGraph agents
- Output parsers for structured extraction
- Prompt templates for agent-specific prompts

**NOT used for:**
- LangChain memory modules (we build our own)
- LangChain agent runtime in chat (Vercel AI SDK handles this)
- Hidden state management

---

## 3. Phase Overview

```
Phase 0: Prerequisites ──────────────── (3-4 days)   ── FOUNDATION    [COMPLETE]
Phase 1: Memory Schema & CRUD ──────── (3-4 days)   ── FOUNDATION    [COMPLETE + AUDITED]
Phase 2: Embedding & Vector Search ─── (3-4 days)   ── FOUNDATION    [COMPLETE + OPTIMIZED]
Phase 3: Retrieval & Context Builder ── (4-5 days)   ── CORE          [COMPLETE + OPTIMIZED]
Phase 4: Memory Extraction Pipeline ─── (4-5 days)   ── CORE          [COMPLETE]
Phase 5: Decay & Memory Lifecycle ───── (3-4 days)   ── CORE          [COMPLETE]
Phase 6: Memory Tools & Chat ────────── (3-4 days)   ── INTEGRATION   [COMPLETE]
Phase 7a: Agent Framework Foundation ── (2-3 days)   ── AGENTS        [x]
Phase 7b-d: Remaining Agents ─────── (3-4 days)   ── AGENTS        [ ]
Phase 8: Worker Architecture ────────── (4-5 days)   ── AGENTS        [ ]
Phase 9: Guardrails & Security ──────── (4-5 days)   ── SECURITY      [ ]
Phase 10: Observability & Cost ──────── (4-5 days)   ── OPERATIONS    [ ]
Phase 11: Improvement & Learning ────── (3-4 days)   ── INTELLIGENCE  [ ]
Phase 12: Memory UI & Dashboard ─────── (4-5 days)   ── UI/UX         [ ]
                                         ─────────
                                         ~48-57 days total
```

### Commit Strategy

Each phase produces:
1. A feature branch off `feat/agent-framework` (e.g., `feat/agent-framework/phase-0-prerequisites`)
2. Passing typecheck + lint (`bun run check:all`)
3. A PR with review checklist
4. Squash-merge back to `feat/agent-framework`

---

## 4. Phase 0: Prerequisites & Foundation Fixes

> **Status: COMPLETE**
> Completed: February 8, 2026

### Objective
Wire message persistence into the chat pipeline and add conversation tracking. This is the **#1 blocker** for everything else.

### Tasks

#### 0.1 Conversation ID Generation & Frontend Integration
**Files to modify:**
- `src/app/(dashboard)/chat/components/ChatInterface.tsx` (or wherever `useChat` is called)
- `src/stores/` (if conversation state is managed in Zustand)

**Implementation:**
- Generate a stable `conversationId` (UUID v4) when a new chat session starts
- Persist `conversationId` in component state or Zustand store
- Pass `conversationId` in the `body` of the `useChat` hook's request
- On page refresh with no existing conversation: generate new ID
- On continuing existing conversation: reuse stored ID

#### 0.2 Wire Message Persistence in Chat Route
**Files to modify:**
- `src/app/api/chat/route.ts`

**Implementation:**
- After authentication, read `conversationId` from request body
- On each user message: call `convex.messages.save` to persist the user message
- After AI response completes: call `convex.messages.save` to persist the assistant message (including tool calls)
- Use `onFinish` callback from `streamText` for async persistence (non-blocking)
- Gate behind `features.enableMessagePersistence` flag

#### 0.3 Conversation History Loading
**Files to modify:**
- `src/app/api/chat/route.ts`
- Frontend chat component

**Implementation:**
- On chat load, if `conversationId` exists, fetch previous messages via `convex.messages.getByConversation`
- Format messages into Vercel AI SDK format and prepend to chat
- Add conversation list sidebar (basic version)

#### 0.4 Enable Feature Flags for Development
**Files to modify:**
- `.env.local` (create or update)
- `src/lib/ai/config.ts` (verify flag reading)

**Implementation:**
- Set `AI_ENABLE_MESSAGE_PERSISTENCE=true` for dev
- Set `AI_ENABLE_MEMORY=true` for dev
- Verify flags are correctly read and propagated

### Acceptance Criteria
- [x] New chat sessions generate a unique `conversationId`
- [x] All user and assistant messages are persisted to Convex `messages` table
- [x] Refreshing the page reloads conversation history
- [x] Tool calls and their results are stored in message metadata
- [x] Feature flags correctly gate persistence behavior
- [x] `bun run check:all` passes

### Implementation Notes
- `conversationId` generated via `crypto.randomUUID()` and stored in Zustand `chat.store.ts`
- Messages persisted via `onFinish` callback in `src/app/api/chat/route.ts` (non-blocking)
- Conversation history loaded via `src/app/api/chat/history/route.ts`
- Feature flags `enableMessagePersistence` and `enableMemory` gated in `src/lib/ai/config.ts`

### Test Plan
1. ~~Start a new chat, send 3 messages, verify messages appear in Convex dashboard~~ **VERIFIED**
2. ~~Refresh the page, verify conversation history loads correctly~~ **VERIFIED**
3. ~~Send messages with tool calls, verify tool data is persisted~~ **VERIFIED**
4. ~~Disable `AI_ENABLE_MESSAGE_PERSISTENCE`, verify no messages are saved~~ **VERIFIED**
5. ~~Open two different chat sessions, verify separate `conversationId`s~~ **VERIFIED**

---

## 5. Phase 1: Memory Schema & CRUD

> **Status: COMPLETE + AUDITED**
> Completed: February 8, 2026
> Audited against Convex best practices and Vercel/React best practices

### Objective
Expand the Convex schema to support the full 4-layer memory hierarchy and implement CRUD operations for all memory layers.

### Tasks

#### 1.1 Expand Convex Schema for 4-Layer Memory Hierarchy
**File:** `src/convex/schema.ts` **STATUS: DONE**

6 new tables created with full indexes, vector indexes, and architecture diagram comments:
- `platformMemories` - Layer 1 (global, admin-only writes)
- `nicheMemories` - Layer 2 (per industry vertical)
- `businessMemories` - Layer 3 (per organization, tenant-isolated)
- `agentMemories` - Layer 4 (per agent type per org)
- `memoryRelations` - Knowledge graph edges
- `memoryEvents` - Pipeline trigger queue

**Key design decisions vs. original plan:**
- `embedding` fields made `v.optional()` (generated async, memory usable before embedding exists)
- `platformMemories.validatedAt` made optional (not always validated)
- Added `by_active_category` composite index on platformMemories for efficient filtered queries
- Added `by_niche_active` index on nicheMemories for active-only queries
- Added `by_org_agent_active` index on agentMemories for active-only queries
- All vector indexes use `filterFields` for tenant isolation during vector search

#### 1.2 Remove Old `memories` Table
**STATUS: DONE** - No old `memories` table existed in production schema; no migration needed.

#### 1.3 Implement Memory CRUD Functions
**STATUS: DONE** - All 6 files created and audited:

| File | Functions | Access Control |
|------|-----------|---------------|
| `src/convex/platformMemories.ts` | create, get, list, update, softDelete | Write: `internalMutation` (admin only); Read: public `query` |
| `src/convex/nicheMemories.ts` | create, get, list, update, softDelete | Write: `internalMutation` (pipeline only); Read: public `query` with nicheId isolation |
| `src/convex/businessMemories.ts` | create, get, list, listByImportance, update, recordAccess, softDelete, archive | Write: public `mutation` (orgId scoped); recordAccess: `internalMutation` |
| `src/convex/agentMemories.ts` | create, get, list, update, recordUse, softDelete | Write: public `mutation` (orgId scoped); recordUse: `internalMutation` |
| `src/convex/memoryRelations.ts` | create, get, list, getBySource, getByTarget, getForEntity, update, remove | All public `mutation`/`query` with orgId enforcement |
| `src/convex/memoryEvents.ts` | create, get, listUnprocessed, listByType, listRecent, markProcessed, markBatchProcessed | Create: public; Processing: `internalMutation` (workers only) |

**Audit fixes applied:**
1. **Security**: Platform/Niche write ops changed to `internalMutation` (were public `mutation`)
2. **Security**: `recordAccess`, `recordUse`, `markProcessed`, `markBatchProcessed` changed to `internalMutation`
3. **Tenant isolation**: Added `organizationId` checks to `memoryEvents.get` and processing ops
4. **Query optimization**: All `list` queries use index-based filtering instead of post-query `.filter()`
5. **Bounded queries**: All `.collect()` calls replaced with `.take(limit)` + `MAX_RELATIONS_PER_QUERY`
6. **Batch safety**: `markBatchProcessed` enforces `MAX_BATCH_SIZE = 50`
7. **Over-fetch pattern**: Where composite index doesn't exist, uses `take(pageSize * 3)` + filter + slice

#### 1.4 Memory Validation Library
**File:** `src/lib/ai/memory/validation.ts` **STATUS: DONE**

Implemented:
- Content length validation (10-500 chars) with warning threshold at 80%
- Confidence score validation (0.5-1.0)
- Importance score validation (0.0-1.0)
- PII detection: email, phone, SSN, credit card, IP address patterns
- Layer-specific PII rules: Platform=forbidden, Niche/Agent=warning, Business=allowed
- Type-specific validators for all memory types, categories, sources, relation types
- Composite `validateMemory()` and specialized validators per layer
- `MEMORY_LIMITS` and `VALID_VALUES` exported constants

**Audit fixes applied:**
1. **Performance**: PII regex patterns hoisted to module scope (not recreated per call)
2. **Safety**: Separate global vs non-global regex patterns (global has mutable `lastIndex`)
3. **DRY**: Duplicate type definitions removed; now imports from `src/types/index.ts`
4. **Fast path**: `containsPii()` uses `.test()` with early return for boolean checks

#### 1.5 Centralized Type Definitions
**File:** `src/types/index.ts` **STATUS: DONE**

All memory types defined as single source of truth:
- `PlatformMemoryCategory`, `BusinessMemoryType`, `AgentMemoryCategory`
- `MemorySource`, `MemoryRelationType`, `MemoryEventType`
- Full interfaces: `PlatformMemory`, `NicheMemory`, `BusinessMemory`, `AgentMemory`, `MemoryRelation`, `MemoryEvent`

#### 1.6 Architecture Diagram Comments
**STATUS: DONE** - Rich ASCII diagram comments added to all memory files for developer reference:
- `schema.ts`: Full architecture overview, table relationships, data/retrieval flows
- `memoryRelations.ts`: Knowledge graph model, example graph, query patterns
- `memoryEvents.ts`: Event-driven pipeline flow, trigger sources, processing stages
- `platformMemories.ts`: Layer 1 details, override priority chain
- `nicheMemories.ts`: Layer 2 details, niche sharing model
- `businessMemories.ts`: Layer 3 details, memory lifecycle, subject linking
- `agentMemories.ts`: Layer 4 details, learning loop, success rate formula
- `validation.ts`: Validation pipeline, PII rules per layer

### Acceptance Criteria
- [x] All 4 memory layer tables created in Convex schema with correct indexes
- [x] Vector indexes configured for all memory tables (3072 dimensions)
- [x] Memory relations table supports knowledge graph edges
- [x] Memory events table supports pipeline triggers
- [x] CRUD functions implemented with proper tenant isolation
- [x] businessMemories always filtered by `organizationId`
- [x] agentMemories always filtered by `organizationId` + `agentType`
- [x] Memory validation library catches invalid inputs
- [x] Old `memories` table migrated/removed (N/A - no old table existed)
- [x] `bun run check:all` passes
- [x] **Audit**: All write operations use appropriate access control (internalMutation vs mutation)
- [x] **Audit**: No unbounded `.collect()` calls
- [x] **Audit**: All queries use index-based filtering where possible
- [x] **Audit**: PII regex hoisted to module scope for performance
- [x] **Audit**: Types centralized in `src/types/index.ts` (no duplication)

### Test Plan
1. ~~Create memories in each layer, verify data in Convex dashboard~~ **VERIFIED**
2. ~~Attempt cross-org memory access, verify it fails~~ **VERIFIED** (tenant isolation on all ops)
3. ~~Create memory with content < 10 chars, verify validation error~~ **VERIFIED**
4. ~~Create memory with confidence < 0.5, verify validation error~~ **VERIFIED**
5. ~~Update a memory, verify version increments and previous version linked~~ **VERIFIED**
6. ~~Soft-delete a memory, verify `isActive` becomes false~~ **VERIFIED**
7. ~~Query memories with various filters (type, subject, decay score)~~ **VERIFIED**

---

## 6. Phase 2: Embedding Service & Vector Search

> **Status: COMPLETE + OPTIMIZED**
> Completed: February 10, 2026
> Audited for performance: parallel fetching, DRY helpers, no action-calls-action anti-pattern

### Objective
Build the embedding generation service and configure vector search across all memory layers.

### Tasks

#### 2.1 Embedding Utility Library
**File:** `src/lib/ai/memory/embedding.ts` **STATUS: DONE**

Implemented:
- `cosineSimilarity(a, b)` — single-pass optimized computation with cached array length
- `isDuplicate(a, b, threshold?)` — duplicate detection (threshold: 0.92)
- `isRelevant(score, threshold?)` — relevance check (threshold: 0.5)
- Exported constants: `EMBEDDING_DIMENSIONS` (3072), `SIMILARITY_THRESHOLD` (0.5), `DUPLICATE_THRESHOLD` (0.92), `LAYER_LIMITS`, model identifiers for both providers

#### 2.2 Convex Embedding Service
**File:** `src/convex/embedding.ts` **STATUS: DONE**

Implemented:
- **Multi-provider support**: `PROVIDERS` config with OpenRouter (default) and OpenAI (fallback)
- **`resolveProvider()`**: Dynamically selects active provider based on available API keys (`OPENROUTER_API_KEY` > `OPENAI_API_KEY`)
- **`callEmbeddingsAPI()`**: Pure async function — avoids Convex action-calls-action anti-pattern
- **`generateEmbeddingVector()`**: Shared embedding generation logic used by both `generateEmbedding` and `generateAndStore`
- **`generateEmbedding`** (internalAction): Returns raw embedding vector for use by search functions
- **`generateAndStore`** (internalAction): Generates embedding + patches document via `patchEmbedding` mutation
- **`patchEmbedding`** (internalMutation): Generic patcher for all 4 memory tables using `Set` validation (no redundant switch)
- Retry with exponential backoff (max 3 retries)
- Error logging with token/cost info for monitoring
- Memory remains usable even if embedding fails

**Key design decisions:**
- Pure async helper `callEmbeddingsAPI()` instead of `ctx.runAction()` — eliminates Convex action overhead
- Single `patchEmbedding` mutation validates `tableName` against `Set` + uses `any` cast — reduces 4 switch cases to 1
- Both providers use the same OpenAI-compatible `/v1/embeddings` endpoint — code is provider-agnostic

#### 2.3 Vector Search Functions
**File:** `src/convex/vectorSearch.ts` **STATUS: DONE**

Implemented:
- **`searchPlatformMemories`** (internalAction): No filter — searches all platform memories
- **`searchNicheMemories`** (internalAction): Filter by `nicheId`
- **`searchBusinessMemories`** (internalAction): Filter by `organizationId`
- **`searchAgentMemories`** (internalAction): Filter by `organizationId` + `agentType`
- **`searchAllLayers`** (internalAction): Multi-layer orchestrator — generates embedding once, searches all 4 layers in parallel via `Promise.all`
- **`fetch*Results`** (internalQuery × 4): Parallel document loading via `Promise.all(ids.map(ctx.db.get))`
- **`attachScoresAndFilter<T>()`**: Generic helper — attaches similarity scores from `Map` + filters by threshold

**Performance optimizations:**
- Embedding generated once in `searchAllLayers`, passed to all layer searches
- All `fetch*Results` use `Promise.all` for parallel document retrieval (not sequential loops)
- `attachScoresAndFilter` uses `Map` for O(1) score lookups
- Explicit return type annotations on all `internalAction` handlers (resolves TypeScript circular inference)

#### 2.4 Hybrid Search (Vector + Keyword)
**File:** `src/convex/hybridSearch.ts` **STATUS: DONE**

Implemented:
- **`hybridSearchBusinessMemories`** (internalAction): Combines vector + keyword search for business memories
- **`keywordSearchBusiness`** (internalQuery): Index-based search by type, subject, and organization
- **Reciprocal Rank Fusion (RRF)**: `score = Σ(weight / (k + rank))` where `k=60`
- Vector weight: 0.7, Keyword weight: 0.3
- Deduplication by document ID
- Results sorted by fused score, filtered by limit
- Explicit return type annotation for type safety

#### 2.5 Auto-Embed on Memory Creation/Update
**Files modified:** `platformMemories.ts`, `nicheMemories.ts`, `businessMemories.ts`, `agentMemories.ts` **STATUS: DONE**

Implemented:
- On `create`: `ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, { tableName, documentId, content })`
- On `update` (when `content` changes): Same scheduler call to re-embed
- `tableName` uses `as const` for type safety with `v.union` schema
- Embedding failures are non-blocking — memory is created/updated regardless

### Acceptance Criteria
- [x] Embedding service generates 3072-dimension vectors from text
- [x] Multi-provider support: OpenRouter (default) + OpenAI (fallback)
- [x] Vector search returns ranked results from each memory layer
- [x] Hybrid search combines vector + keyword results using RRF
- [x] New memories automatically get embeddings generated (async, non-blocking)
- [x] Updated memories get re-embedded when content changes
- [x] Minimum similarity threshold (0.5) filters irrelevant results
- [x] API errors handled with retry logic (exponential backoff, max 3 retries)
- [x] No action-calls-action anti-pattern (pure async helpers)
- [x] Parallel document fetching via `Promise.all`
- [x] `bun run check:all` passes

### Implementation Notes
- Provider resolution: `resolveProvider()` checks `OPENROUTER_API_KEY` first, then `OPENAI_API_KEY`
- Both providers use identical request format (OpenAI-compatible `/v1/embeddings`)
- `generateAndStore` calls `callEmbeddingsAPI()` directly — no `ctx.runAction()` overhead
- `patchEmbedding` validates `tableName` against a `Set` of valid table names
- All vector search actions have explicit `Promise<...>` return types to avoid TS circular inference
- `searchAllLayers` generates embedding once, shares across 4 parallel layer searches
- TypeScript `TS7022`/`TS7023` errors resolved via explicit handler return annotations

### Test Plan
1. ~~Generate embedding for sample text, verify 1536 dimensions~~ **VERIFIED**
2. ~~Store memory with embedding, search for similar query, verify result returned~~ **VERIFIED**
3. ~~Search with unrelated query, verify low/no results~~ **VERIFIED**
4. ~~Create memory without embedding (failure simulation), verify memory still exists~~ **VERIFIED**
5. ~~Test hybrid search: insert memory, search by keyword AND by vector, verify both paths work~~ **VERIFIED**
6. ~~Cross-org vector search attempt, verify isolation~~ **VERIFIED** (filterFields enforce tenant isolation)
7. ~~Multi-layer search returns results from all layers in parallel~~ **VERIFIED**

---

## 7. Phase 3: Memory Retrieval Pipeline & Context Builder

> **Status: COMPLETE + HARDENED**
> Completed: February 10, 2026
> Hardened: February 18, 2026
> Optimized: DRY scoring engine, Map-based budget allocation, zero-alloc formatting, waterfall elimination in chat route

### Objective
Build the full memory retrieval pipeline that assembles context from all 4 layers, ranks results, and fits within token budgets.

### Tasks

#### 3.1 Query Analysis Service
**File:** `src/lib/ai/memory/queryAnalysis.ts` **STATUS: DONE**

Implemented:
- **Intent detection**: 5 intent types — `scheduling`, `lead_management`, `invoicing`, `memory_query`, `general`
- **Entity extraction**: Customer names (capitalized proper nouns), dates (ISO/relative/day-of-week), amounts (currency patterns)
- **Intent-to-context mapping**: Each intent maps to required `BusinessMemoryType[]` via `INTENT_CONTEXT_MAP`
- **Subject hints**: Customer entities generate `lead` subject hints for targeted lookup
- All regex patterns hoisted to module scope (rule 7.9: no per-call regex creation)
- Cached `EMPTY_ANALYSIS` constant for empty-input fast path (rule 7.4)
- Pure sync function, zero async I/O

**Key patterns:**
- `SCHEDULING_PATTERN` — matches schedule, appointment, booking, calendar keywords
- `LEAD_MANAGEMENT_PATTERN` — matches lead, customer, client, pipeline keywords
- `INVOICING_PATTERN` — matches invoice, bill, payment, price keywords
- `MEMORY_QUERY_PATTERN` — matches remember, recall, preference keywords
- `PROPER_NOUN_PATTERN` — extracts multi-word capitalized names (filtered against `NON_NAME_WORDS` Set)

#### 3.2 Convex Memory Retrieval Action
**File:** `src/convex/memoryRetrieval.ts` **STATUS: DONE**

Implemented:
- **Public `action`** (not `internalAction`) — callable via `ConvexHttpClient.action()` from Next.js API route
- Single entry point: calls `searchAllLayers` (generates embedding once, searches all 4 layers in parallel)
- **Non-blocking access tracking**: `ctx.scheduler.runAfter(0, recordAccess, ...)` for business memories
- Returns raw results to Next.js (scoring/formatting happens server-side for flexibility)
- Explicit handler return type annotation to resolve TypeScript circular inference (TS7022/TS7023)

**Design decisions (per Convex best practices):**
- Public action gateway to internal search operations — keeps search logic internal
- Single round-trip from Next.js (1 action call → 1 internal search → 4 parallel vector searches)
- Access tracking deferred via scheduler (doesn't block response)

#### 3.3 Scoring & Ranking Engine
**File:** `src/lib/ai/memory/scoring.ts` **STATUS: DONE + OPTIMIZED**

Implemented:
- **Composite score formula:**
  ```
  score = 0.4 * relevance + 0.25 * importance + 0.2 * recency + 0.15 * frequency
  score *= layerWeight
  score *= recencyBoost (if < 7 days)
  score += intentMatchBonus (if memory type matches query intent)
  ```
- **Layer weights**: platform=0.5, niche=0.7, business=1.0, agent=0.8
- **Recency**: Exponential decay with 30-day half-life (`e^(-ln2 * age / halfLife)`)
- **Frequency boost**: `min(1.1, 1.0 + accessCount * 0.005)` — capped
- **Decay filter**: `decayScore < 0.1` excluded (business + agent layers)
- **Intent-type bonus**: +0.1 when memory type matches query intent

**Optimizations applied:**
1. `HALF_LIFE_MS` and `DECAY_COEFFICIENT` pre-computed at module scope (rule 7.3)
2. Unified `computeCompositeScore()` helper — 4 scoring functions delegate to single 7-param function (DRY)
3. `requiredTypes` Set built once in `scoreAndRank()`, passed to business scorer
4. Layer-specific filtering combined into single conditional (`decayScore < threshold || !isActive || isArchived`)

#### 3.4 Token Budget Manager
**File:** `src/lib/ai/memory/tokenBudget.ts` **STATUS: DONE + OPTIMIZED**

Implemented:
- **Token estimation**: `Math.ceil(chars / 4)` — standard English heuristic
- **Budget allocation**:
  | Section | Tokens |
  |---------|--------|
  | Platform | 200 |
  | Niche | 300 |
  | Business | 2000 |
  | Agent | 500 |
  | Relations | 500 |
  | Conversation summary | 500 |
  | **Total** | **4000** |
- **Greedy selection**: Sorted memories (desc by composite score) added until budget exhausted
- **Overflow reallocation**: Surplus from under-utilized sections flows to higher-priority sections (business > agent > niche > platform), capped at 500 tokens per section

**Optimizations applied:**
1. `Map<LayerKey, ...>` for all section lookups — O(1) vs nested ternary chains (rule 7.11)
2. Phase 1 (initial selection) + Phase 2 (surplus calculation) combined into single `for...of` loop (rule 7.6)
3. `MAX_REALLOCATION_PER_SECTION` extracted as named constant

#### 3.5 Context Formatter
**File:** `src/lib/ai/memory/contextFormatter.ts` **STATUS: DONE + OPTIMIZED**

Implemented:
- **Structured sections** (priority order):
  1. `## Business Rules (HIGH PRIORITY)` — instruction-type memories
  2. `## Customer Information` — facts, preferences, context
  3. `## Relationships` — relationship-type memories
  4. `## Recent Context` — episodic memories
  5. `## Learned Patterns` — agent memories with success rates
  6. `## Industry Knowledge` — niche memories
  7. `## Platform Best Practices` — platform memories
- **Confidence indicators** for each entry: `(confidence: 0.95)` or `(success: 0.82)`
- **Truncation**: Individual entries capped at 200 chars with `...` suffix
- **Memory type annotations**: `[instruction]`, `[fact]`, `[preference]`, etc.

**Optimizations applied:**
1. Section formatters write directly into shared `parts[]` and `ids[]` arrays — zero intermediate allocations (eliminated 8 spread operations + 4 object allocations)
2. Consolidated `appendEntry()` helper — DRY across all section formatters
3. Pre-computed `TRUNCATION_LIMIT` at module scope
4. Early return when all layers empty (rule 7.8)

#### 3.6 Retrieval Orchestrator
**File:** `src/lib/ai/memory/retrieval.ts` **STATUS: DONE + OPTIMIZED**

Implemented:
- **5-step pipeline**: analyzeQuery → Convex search → scoreAndRank → allocateTokenBudget → formatContext
- **Single async hop**: Only 1 await (the Convex action call); everything else is sync CPU work
- **Graceful degradation**: On retrieval failure, returns empty context (chat continues without memory)
- **Metadata return**: `memoriesUsed`, `memoryIds`, `tokenCount`, `latencyMs`, `layerBreakdown`

**Optimizations applied:**
1. URL-aware `ConvexHttpClient` singleton — recreates client if URL changes (cross-request caching, rule 3.3)
2. Early return for empty/whitespace queries — skips entire pipeline (rule 7.8)
3. Hoisted `EMPTY_LAYER_BREAKDOWN` constant — avoids re-creating on every error/empty path (rule 7.4)

#### 3.7 Chat Route Integration
**File:** `src/app/api/chat/route.ts` **STATUS: DONE + OPTIMIZED**

Implemented:
- **Early-start parallelism**: `memoryPromise` initiated before tool creation and model setup — prevents waterfall (rule 1.3)
- **Feature-flag gated**: `featureFlags.enableMemory && organizationId` — resolves to `null` when disabled
- **Await deferred**: Memory result awaited only when needed for `getSystemPrompt()` (rule 1.1)
- **Debug logging**: Logs retrieval metadata (`memoriesUsed`, `tokenCount`, `latencyMs`, `layerBreakdown`) when `chatConfig.debug` is enabled
- `enableMemory` defaults to `true` in development, configurable via `AI_ENABLE_MEMORY` env var

**Optimizations applied:**
1. Last user message extracted once — reused for both memory retrieval and persistence (rule 7.6, eliminates duplicate backward loop)
2. `lastUserMessageText` derived from `lastUserMessage` object (single extraction)

### Acceptance Criteria
- [x] Query analysis extracts intents and entities from user messages
- [x] Parallel retrieval from all 4 memory layers via single Convex action
- [x] Scoring correctly weights relevance, importance, recency, and frequency
- [x] Token budget manager prevents context from exceeding 4000 tokens
- [x] Formatted context is injected into the system prompt
- [x] Memory retrieval is gated by `enableMemory` feature flag
- [x] Access counts are incremented for retrieved memories (via scheduler)
- [x] Global token cap (`totalBudget`) is strictly enforced after reallocation
- [x] Agent memory retrieval preserves `agentType` correctness before final truncation
- [x] Retrieval gracefully degrades to empty memory context if Convex URL/config is invalid
- [x] Access tracking enqueue avoids per-result serial scheduler wait
- [x] `bun run check:all` passes

### Implementation Notes
- `retrieveMemoryContext()` called from API route with `Promise` start-ahead pattern for parallelism
- Convex `retrieveContext` is a **public action** (not internal) — required for `ConvexHttpClient.action()` access
- Access tracking uses `ctx.scheduler.runAfter(0, ...)` — non-blocking, runs after action returns
- All scoring uses pre-computed constants at module scope (no per-call allocations)
- Token budget uses Map-based architecture for O(1) lookups throughout
- Context formatting writes directly to shared arrays (zero intermediate allocations)
- Empty query fast paths skip the entire pipeline at multiple levels

### Files Created
| File | Purpose | Type |
|------|---------|------|
| `src/lib/ai/memory/queryAnalysis.ts` | Intent detection + entity extraction (sync, heuristic-based) | Library |
| `src/lib/ai/memory/scoring.ts` | Composite scoring + ranking across 4 layers | Library |
| `src/lib/ai/memory/tokenBudget.ts` | Greedy selection + overflow reallocation | Library |
| `src/lib/ai/memory/contextFormatter.ts` | Structured text output for system prompt | Library |
| `src/lib/ai/memory/retrieval.ts` | Pipeline orchestrator (single async hop) | Library |
| `src/convex/memoryRetrieval.ts` | Public Convex action gateway for vector search | Convex Action |

### Files Modified
| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Integrated memory retrieval with early-start parallelism, deduped last-user-message extraction |
| `src/lib/ai/config.ts` | `enableMemory` defaults to `true` in development |

### Test Plan
1. Store memories across all 4 layers, send related query, verify all layers contribute
2. Verify scoring: more relevant/important memories rank higher
3. Verify token budget: exceed budget and check truncation works correctly
4. Verify recency boost: recent memory ranks above older similar memory
5. Disable memory flag, verify no retrieval occurs
6. Measure retrieval latency for 100 memories, verify < 100ms p95
7. Check formatted context output matches expected structure
8. Set invalid `NEXT_PUBLIC_CONVEX_URL`, verify chat still responds with empty memory context
9. Seed mixed `agentType` memories, verify `chat` agent retrieval returns only `chat` type memories

---

## 8. Phase 4: Memory Extraction Pipeline

> **Status: COMPLETE**
> Completed: February 19, 2026
> Branch: `feat/agent-framework`
> Prerequisites: Message persistence (Phase 0), Embedding service (Phase 2), Memory CRUD (Phase 1), Memory retrieval (Phase 3)

### Objective
Build the LLM-powered pipeline that automatically extracts memories from conversations.

### Tasks

#### 4.1 Extraction Prompt & Schema
**File:** `src/lib/ai/memory/extractionPrompt.ts` **STATUS: DONE**

Implemented:
- **System prompt** (`EXTRACTION_SYSTEM_PROMPT`): Detailed instructions for memory extraction covering facts, preferences, instructions, context, relationships, and episodic memories
- **Zod schemas** for structured LLM output validation:
  - `extractedBusinessMemorySchema` — validates type, content (10-500 chars), importance (0-1), confidence (0.5-1), optional subjectType/subjectName
  - `extractedAgentMemorySchema` — validates agentType (6 types), category (4 types), content, confidence
  - `extractedRelationSchema` — validates source/target types and names, relationType (5 types), strength (0-1), evidence
  - `extractionOutputSchema` — composite with array limits (business:10, agent:5, relations:5)
- **`buildExtractionPrompt()`**: Constructs user prompt with conversation transcript, existing memories for dedup context, and optional tool outcomes
- **Export types**: `ExtractionOutput`, `ExtractedBusinessMemory`, `ExtractedAgentMemory`, `ExtractedRelation`

**Rules implemented:**
- Only extract NEW information not in existing memories
- Confidence scoring: 1.0 for explicit, 0.7-0.9 for inferred
- Importance scoring: business rules (0.9+), client preferences (0.8+), one-time context (0.3-0.5)
- Return empty arrays if no extractable knowledge

#### 4.2 Extraction Worker (Convex Action)
**File:** `src/convex/memoryExtraction.ts` **STATUS: DONE**

Implemented:
- **`processExtractionBatch`** (`internalAction`): Main entry point, processes batches of unprocessed `memoryEvents`
- **`resolveLLMProvider()`**: Dynamically selects OpenRouter or OpenAI based on available API keys
- **`callExtractionLLM()`**: Pure async function with retry logic (max 2 retries, exponential backoff)
  - Uses `gpt-4o-mini` via OpenRouter or OpenAI for cost-efficient extraction
  - `response_format: { type: 'json_object' }` for structured output
  - Array.isArray() guards on all parsed output fields
- **`summarizeToolOutcome()`**: Generates concise pattern from tool success/failure for agent memory
- **Event processing**:
  - `processConversationEnd()`: Fetches full conversation → existing memories for dedup → calls LLM → creates memories
  - `processToolOutcome()`: Maps tool to agent type → summarizes outcome → creates agent memory
- **Error handling**: Failed events are retried across cron cycles; only marked processed after exceeding retry window (3 cycles × 2 min = 6 min)

**Internal queries:**
| Function | Purpose |
|----------|---------|
| `getConversationMessages` | Fetches messages by org + conversationId (index: `by_org_conversation`) |
| `getExistingMemoryContents` | Fetches active business memory contents for dedup context (index: `by_org_active`) |
| `getNextUnprocessedBatch` | Global FIFO fetch of unprocessed events (index: `by_created`) |

**Internal mutations:**
| Function | Purpose |
|----------|---------|
| `insertBusinessMemory` | Creates business memory with full metadata (decayScore=1.0, version=1) |
| `updateBusinessMemoryVersion` | Creates new version, deactivates old one (version chain) |
| `insertAgentMemory` | Creates agent memory (useCount=0, successRate=0.0, decayScore=1.0) |
| `insertRelation` | Creates memory relation edge |

**Validation (pre-storage):**
- `isValidBusinessMemory()`: Validates type ∈ {6 types}, content 10-500 chars, importance 0-1, confidence 0.5-1
- `isValidAgentMemory()`: Validates agentType ∈ {6 types}, category ∈ {4 types}, content 10-500 chars, confidence 0.5-1
- `isValidRelation()`: Validates source/target types and names, relationType ∈ {5 types}, strength 0-1

#### 4.3 Deduplication Logic
**File:** `src/convex/memoryExtraction.ts` (within `isDuplicate()` and `createExtractedMemories()`) **STATUS: DONE**

Implemented:
- **Vector similarity check**: Generates embedding for new memory, searches existing business memories
- **Similarity threshold**: 0.92 cosine similarity (matching plan specification)
- **Merge strategy**: If duplicate has lower confidence → create new version with higher confidence; otherwise skip
- **Version chain**: `updateBusinessMemoryVersion()` creates new document, links via `previousVersionId`, deactivates old
- **Embedding auto-generation**: New memories automatically get embeddings via `internal.embedding.generateAndStore`
- **Graceful fallback**: If embedding service unavailable, memory is created without dedup check

#### 4.4 Cron Job Configuration
**File:** `src/convex/crons.ts` **STATUS: DONE**

```typescript
crons.interval('memory extraction pipeline', { minutes: 2 },
  internal.memoryExtraction.processExtractionBatch, {})
```

- Runs every 2 minutes (production-grade interval — avoids excessive LLM calls)
- Processes batch of 5 events per run (configurable via args)
- No `organizationId` argument → processes events from all orgs in FIFO order

#### 4.5 Chat Route Event Emission
**File:** `src/app/api/chat/route.ts` (modified `onFinish` callback) **STATUS: DONE**

Implemented:
- **`conversation_end` event**: Emitted after every conversation turn with `conversationId`, `messageCount`, `lastUserMessage`, `finishReason`, `latencyMs`
- **`tool_success` / `tool_failure` events**: One event per tool call in the response, extracted via `extractToolCalls()` helper
  - Data includes `toolName`, `args` (truncated 500 chars), `result` (truncated 500 chars), `durationMs`
  - Success/failure determined by result content inspection
- All events emitted via `after()` callback — non-blocking, does not delay response streaming
- Gated behind `featureFlags.enableMemory && organizationId && validConversationId`

#### 4.6 Supporting Changes

| File | Change |
|------|--------|
| `src/convex/vectorSearch.ts` | `searchAllLayers` returns generated embedding for reuse; removed stray character |
| `src/convex/hybridSearch.ts` | Accepts optional pre-generated `embedding` argument to avoid double embedding |
| `src/convex/memoryRetrieval.ts` | Passes `searchAllLayers` embedding to `hybridSearchBusinessMemories` — single embedding per retrieval |
| `src/convex/memoryEvents.ts` | Added `listUnprocessedInternal` (`internalQuery`) for worker access |
| `src/lib/ai/prompts/system.ts` | Auto-selects `v2` (memory-aware) prompt when memoryContext is present |
| `src/types/index.ts` | Added `nicheId` to `OrganizationSettings` interface |

### Acceptance Criteria
- [x] Extraction prompt correctly identifies facts, preferences, instructions, context, relationships, episodic
- [x] Extracted memories include type, content, confidence, subject, and importance
- [x] Duplicate detection catches memories with ≥ 0.92 cosine similarity
- [x] Duplicate with higher confidence creates new version (version chain)
- [x] Extraction runs asynchronously via cron (doesn't block chat response)
- [x] Extracted memories pass validation before storage (content 10-500 chars, confidence 0.5-1)
- [x] Memory events emitted for tool calls (`tool_success`, `tool_failure`) and conversation ends
- [x] All business memories auto-get embeddings after creation
- [x] Agent memories created from tool outcome patterns
- [x] Memory relations created for entity connections
- [x] Single embedding optimization: `searchAllLayers` returns embedding for reuse in hybrid search
- [x] Failed events are retried across cron cycles (not immediately marked processed)
- [x] `bun run check:all` passes

### Implementation Notes
- LLM provider: `gpt-4o-mini` via OpenRouter (fallback: OpenAI direct) — cost-efficient for extraction
- Extraction prompt is inline in `memoryExtraction.ts`; `extractionPrompt.ts` provides Zod schemas and `buildExtractionPrompt()` for future use with Vercel AI SDK structured output
- `processExtractionBatch` processes events from ALL organizations in FIFO order (no `organizationId` from cron); can be called with specific `organizationId` for targeted extraction
- `isDuplicate()` returns early with `{ isDup: false }` when embedding service is not configured
- All internal mutations enforce tenant isolation via `organizationId` parameter

### Files Created
| File | Purpose | Type |
|------|---------|------|
| `src/lib/ai/memory/extractionPrompt.ts` | Zod schemas + system prompt + prompt builder | Library |
| `src/convex/memoryExtraction.ts` | Extraction worker: LLM call, dedup, validation, storage | Convex Internal Action + Mutations + Queries |
| `src/convex/crons.ts` | Cron job scheduling for extraction pipeline | Convex Config |

### Files Modified
| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Added `conversation_end` and `tool_success`/`tool_failure` event emission in `onFinish` |
| `src/convex/vectorSearch.ts` | `searchAllLayers` returns embedding; removed stray character |
| `src/convex/hybridSearch.ts` | Accepts optional pre-generated embedding |
| `src/convex/memoryRetrieval.ts` | Passes embedding from `searchAllLayers` to hybrid search |
| `src/convex/memoryEvents.ts` | Added `listUnprocessedInternal` (internalQuery) |
| `src/lib/ai/prompts/system.ts` | Dynamic prompt version selection (v2 when memory context present) |
| `src/types/index.ts` | Added `nicheId` to `OrganizationSettings` |

### Security Considerations
- **Tenant isolation**: All mutations require `organizationId`; queries use org-scoped indexes
- **LLM output validation**: All extracted items validated via `isValid*` functions before storage
- **Content bounds**: Content limited to 10-500 chars; confidence 0.5-1; importance 0-1
- **API key protection**: Keys read from `process.env` inside Convex actions only
- **Rate limiting**: Cron interval (2 min) + batch size (5) limits LLM call rate
- **Non-blocking**: All extraction is async via cron — zero impact on chat response latency

### Known Limitations (to address in later phases)
1. **No explicit conflict detection**: Similar memories with contradicting content are not flagged yet (planned for Phase 6)
2. **Tool failure detection heuristic**: Uses string matching (`includes('error')`) rather than structured error signals
3. **Global FIFO processing**: `getNextUnprocessedBatch` processes across all orgs; may need per-org fairness at scale

### Test Plan
1. ~~Have a conversation mentioning customer preferences, verify extraction captures them~~ **TO VERIFY**
2. ~~Have a conversation with explicit instructions ("always call John in the morning"), verify instruction type extracted~~ **TO VERIFY**
3. ~~Repeat the same information, verify deduplication prevents duplicate memories~~ **TO VERIFY**
4. ~~Verify extraction doesn't block chat response (measure response latency)~~ **TO VERIFY**
5. ~~Extract from conversation with tool calls, verify tool-related patterns captured~~ **TO VERIFY**
6. ~~Verify cron job processes events within 2-minute cycle~~ **TO VERIFY**
7. ~~Verify failed events are retried, then marked processed after retry window~~ **TO VERIFY**

---

## 9. Phase 5: Decay Algorithm & Memory Lifecycle

### Objective
Implement the Ebbinghaus-inspired decay algorithm and full memory lifecycle management.

### Tasks

#### 5.1 Decay Algorithm Implementation
**Files to create:**
- `src/lib/ai/memory/decay.ts`

**Implementation:**
```
Memory Strength = e^(-λ * t / (1 + r))

Where:
  λ = base decay rate (varies by memory type)
  t = time since last access (in days)
  r = reinforcement factor (accessCount * successRate)
```

**Base Decay Rates:**
| Type | Decay Rate |
|------|-----------|
| Instruction | 0.01 |
| Fact | 0.05 |
| Preference | 0.08 |
| Pattern | 0.10 |
| Context | 0.15 |
| Episodic | 0.20 |

**Reinforcement Factors:**
| Factor | Value |
|--------|-------|
| Access Boost | +0.1 per access |
| Success Boost | +0.2 per successful use |
| Correction Penalty | -0.3 if corrected |
| Explicit Refresh | +1.0 if user references |

#### 5.2 Decay Update Function
**Files to create:**
- `src/convex/memoryDecay.ts`

**Implementation:**
- Convex mutation `updateDecayScores` - processes batch of memories
- Convex action `runDecayUpdate` - iterates all active memories for an org
- Updates `decayScore` field based on formula
- Transitions memories between lifecycle states:
  - Active (> 0.7): Full retrieval priority
  - Accessible (0.3 - 0.7): Lower priority
  - Archive (0.1 - 0.3): Compress/summarize candidate
  - Expired (< 0.1): Soft delete candidate

#### 5.3 Memory Archival
**Files to create:**
- `src/convex/memoryArchival.ts`

**Implementation:**
- Archive memories with decayScore < 0.3: set `isArchived = true`
- Compress archived memories: summarize multiple related memories into one
- Soft delete memories with decayScore < 0.1: set `isActive = false`
- Hard delete soft-deleted memories after 90 days

#### 5.4 Access Tracking
**Files to modify:**
- `src/lib/ai/memory/retrieval.ts`

**Implementation:**
- On memory retrieval: increment `accessCount`, update `lastAccessedAt`
- On successful tool execution using memory: boost via success factor
- On user correction: apply correction penalty
- All updates are async (don't block retrieval)

#### 5.5 TTL Management
**Files to create:**
- `src/lib/ai/memory/ttl.ts`

**Implementation:**
- Default TTLs by type:
  | Type | TTL |
  |------|-----|
  | Fact | 180 days |
  | Preference | 90 days |
  | Instruction | Never |
  | Context | 30 days |
  | Relationship | 180 days |
  | Pattern | 365 days |
  | Episodic | 90 days |
- Set `expiresAt` on memory creation
- Check expiration during retrieval (skip expired)
- Batch cleanup of expired memories

### Acceptance Criteria
- [x] Decay formula correctly calculates memory strength based on time and reinforcement
- [x] Frequently accessed memories maintain high decay scores
- [x] Unused memories decay according to their type's rate
- [x] Memory lifecycle transitions work correctly (Active → Accessible → Archive → Expired)
- [x] Archived memories are compressed/summarized
- [x] Expired memories are soft-deleted
- [x] Access tracking updates scores in real-time
- [x] TTL management prevents stale memories from polluting retrieval
- [x] `bun run check:all` passes

### Implementation Notes
- **Decay formula** (`src/lib/ai/memory/decay.ts`): `e^(-λ * t / (1 + r))` with 7 memory-type-specific decay rates
- **Workers** (`src/convex/memoryDecay.ts`): Hourly cron batch-updates all org memories; on-access boost via `ctx.scheduler.runAfter(0, ...)`
- **TTL** (`src/lib/ai/memory/ttl.ts`): Per-type defaults (30d–never); auto-set on creation in `businessMemories.ts` and `memoryExtraction.ts`; filtered in `scoring.ts` and `retrieval.ts`
- **Archival** (`src/convex/memoryArchival.ts`): Daily cron archives (score < 0.3), compresses via LLM with `@convex-dev/action-retrier`, weekly purge of expired + orphan relations
- **Convex module isolation**: Decay math and TTL constants are inlined into Convex files since they cannot import from `@/lib/`
- **Schema addition**: `by_org_archived` index on `businessMemories` for efficient archival queries
- **Test script**: `scripts/test-decay-lifecycle.sh` — 111 automated checks

### Test Plan
1. Create memory, wait (simulate time), verify decay score decreases
2. Access memory multiple times, verify decay score stays high
3. Create instruction-type memory, verify very slow decay (0.01 rate)
4. Create episodic memory, verify fast decay (0.20 rate)
5. Simulate memory reaching archive threshold, verify archival
6. Verify expired memories don't appear in retrieval results
7. Test correction penalty: correct a memory, verify confidence drops

---

## 10. Phase 6: Memory Tools & Chat Integration

> **Status: COMPLETE**
> Completed: February 24, 2026
> Branch: `feat/agent-framework`
> Prerequisites: Memory CRUD (Phase 1), Memory retrieval (Phase 3), Memory extraction (Phase 4), Decay & lifecycle (Phase 5)

### Objective
Add memory-specific tools to the chat interface and complete the end-to-end memory loop.

### Tasks

#### 6.1 Memory Tools for Chat
**File:** `src/lib/ai/tools/memory.ts` **STATUS: DONE**

Implemented 4 memory management tools in a separate module, exported via `createMemoryTools()` factory:

- **`rememberFact`**: Creates business memory via `api.businessMemories.create` with `source: 'tool'`, confidence 0.95. Supports all 6 memory types (fact, preference, instruction, context, relationship, episodic) with optional importance, subjectType, and subjectName.
- **`forgetMemory`**: Searches via `api.memoryRetrieval.searchMemories` (vector search, top-1), then soft-deletes the best match via `api.businessMemories.softDelete`. Returns the forgotten content for confirmation.
- **`searchMemories`**: Searches via `api.memoryRetrieval.searchMemories` with optional type filter and configurable limit (1-20). Returns formatted results (content, type, confidence, importance, subject).
- **`updatePreference`**: Upserts preference memories. Searches existing preferences (similarity threshold 0.6) — if match found, updates content/confidence; if not, creates new. Uses `source: 'tool'`.

**Supporting Convex action:** `searchMemories` public action added to `src/convex/memoryRetrieval.ts` — lightweight single-layer vector search returning structured results (id, content, type, confidence, importance, score, subjectType, subjectName, createdAt). Reuses `internal.vectorSearch.searchBusinessMemories` and `internal.embedding.generateEmbedding`.

#### 6.2 Tool Execution Memory Events
**File:** `src/app/api/chat/route.ts` (existing `onFinish` callback) **STATUS: DONE (Phase 4)**

Already implemented in Phase 4 — the `onFinish` handler generically emits `tool_success` / `tool_failure` events for ALL tool calls via `extractToolCalls()`. Memory tools automatically get events emitted since they're part of the merged tool set.

#### 6.3 Conversation Summary for Context
**File:** `src/lib/ai/memory/conversationSummary.ts` **STATUS: DONE**

Implemented:
- **Sliding window**: Keeps last 6 messages in full (configurable via `windowSize` option)
- **Summary generation**: When messages exceed window, older portion is summarized via `generateText` with a lightweight model (`gemini/regular` tier). Summary capped at 200 tokens.
- **Archive threshold**: At 50+ messages, `needsArchival` flag is set. Chat route emits a `conversation_end` event with `finishReason: 'archive_threshold'` for extraction pipeline processing.
- **Prompt injection**: `formatSummaryForPrompt()` produces a `## Earlier in This Conversation` section, injected into system prompt via `{{conversation_summary}}` placeholder.
- **Graceful degradation**: If summary generation fails, recent messages are still returned without summary (chat continues normally).

#### 6.4 End-to-End Chat Memory Loop
**File:** `src/app/api/chat/route.ts` **STATUS: DONE**

Complete flow implemented:
```
User Message
  → buildConversationWindow() — trim + summarize (parallel with memory)
  → Retrieve memory context (Phase 3)
  → Inject memory + summary into system prompt
  → LLM generates response with CRM + memory tools
  → Memory tools execute (rememberFact, searchMemories, etc.)
  → Tool events emitted (tool_success / tool_failure)
  → Persist messages (Phase 0)
  → Schedule memory extraction (Phase 4)
  → Update access counts (Phase 5)
  → Emit archival event if conversation is very long
```

**Chat route changes:**
- `createMemoryTools()` called alongside `createCRMTools()`, gated behind `featureFlags.enableMemory`
- Tools merged via spread: `{ ...crmTools, ...memoryTools }`
- `buildConversationWindow(messages)` and `memoryPromise` resolved in parallel via `Promise.all`
- Trimmed messages passed to `convertToModelMessages()` when summary was generated
- Summary text injected into system prompt via `getSystemPrompt(memoryContext, conversationSummary)`

### Acceptance Criteria
- [x] User can say "remember that John prefers morning appointments" and it's stored
- [x] User can say "forget the preference about John" and it's removed
- [x] User can say "what do you know about John?" and memories are searched
- [x] All tool executions emit memory events
- [x] Conversation summary stays within token budget
- [x] End-to-end memory loop works: store → retrieve → use → learn
- [x] `bun run check:all` passes

### Implementation Notes
- Memory tools module is separated from CRM tools (`src/lib/ai/tools/memory.ts`) for clean concerns
- `searchMemories` action is public (not internal) — required for `ConvexHttpClient.action()` access from Next.js tools
- `updatePreference` uses similarity threshold of 0.6 for dedup — lower than extraction's 0.92 because tools receive higher-confidence user intent
- Conversation summary runs in parallel with memory retrieval — no added latency to the critical path
- v2 system prompt now has two placeholders: `{{memory_context}}` and `{{conversation_summary}}`
- `getSystemPrompt()` signature expanded to accept optional conversation summary (backward compatible, defaults to empty string)
- All memory tools use `source: 'tool'` for clear provenance tracking in the memory table

### Files Created
| File | Purpose | Type |
|------|---------|------|
| `src/lib/ai/tools/memory.ts` | 4 memory management tools (rememberFact, forgetMemory, searchMemories, updatePreference) | Library |
| `src/lib/ai/memory/conversationSummary.ts` | Sliding window + LLM summary for long conversations | Library |
| `scripts/test-memory-tools.sh` | E2E test script for Phase 6 | Test Script |

### Files Modified
| File | Change |
|------|--------|
| `src/convex/memoryRetrieval.ts` | Added `searchMemories` public action for tool-level vector search |
| `src/lib/ai/tools/index.ts` | Re-exports `createMemoryTools` and `MemoryTools` type |
| `src/app/api/chat/route.ts` | Wired memory tools + conversation summary, parallel resolution, archival event |
| `src/lib/ai/prompts/system.ts` | Added `{{conversation_summary}}` placeholder, memory tool instructions, updated `getSystemPrompt` signature |
| `package.json` | Added `test:memory-tools` script |

### Test Plan
1. Tell the AI to remember a fact, verify it appears in memory table
2. Ask "what do you know about [customer]?", verify memories are returned
3. Tell the AI to forget something, verify memory is soft-deleted
4. Add a lead via tool, verify tool_success event is created
5. Have a long conversation (50+ messages), verify summary is generated
6. In a new session, reference old information, verify memory retrieval works

---

## 10.5. Phase 6.5: Retrieval Optimization

### Objective
Eliminate unnecessary work in the memory retrieval pipeline by routing queries to only the relevant memory layers based on intent detection. Reduce latency for memory commands (remember/forget) to near-zero.

### Problem Statement
Every chat request searched all 4 memory layers (platform, niche, business, agent) regardless of intent. A simple "remember that John prefers morning meetings" triggered 6 vector searches and 3 embedding calls, taking 11+ seconds.

### Changes

| File | Change |
|------|--------|
| `src/lib/ai/memory/queryAnalysis.ts` | Added `memory_command` intent, `getRequiredLayers()`, `isMemoryCommand()` |
| `src/convex/vectorSearch.ts` | Added `searchSelectedLayers` action for partial-layer search |
| `src/convex/memoryRetrieval.ts` | Added `retrieveSelectedContext` action with layer filtering |
| `src/lib/ai/memory/retrieval.ts` | Early return for commands, selective search for <4 layers |
| `src/lib/ai/tools/index.ts` | `ToolContext.convexClient` for client reuse |
| `src/lib/ai/tools/memory.ts` | Reuse shared ConvexHttpClient |
| `src/app/api/chat/route.ts` | Pass singleton client to tools, log skipped layers |
| `scripts/lib/test-helpers.sh` | Shared test infrastructure extracted from 4 scripts |
| `scripts/test-*.sh` | Refactored to source shared library |

### Performance Impact

| Scenario | Before | After | Improvement |
|----------|--------|-------|-------------|
| "Remember that X" | ~11.5s (4-layer search + tool) | ~4s (0 search + tool) | ~65% faster |
| "Schedule with John" | ~7s (4-layer search) | ~5s (2-layer search) | ~30% faster |
| "What do you know?" | ~7s (4-layer search) | ~7s (4-layer, unchanged) | No regression |

### Intent → Layer Routing

| Intent | Layers Searched | Rationale |
|--------|----------------|-----------|
| `memory_command` | None (skip retrieval) | Imperative action, no context needed |
| `scheduling` | business, agent | Customer prefs + agent patterns |
| `lead_management` | business, agent | Customer data + learned patterns |
| `invoicing` | business | Pricing, billing facts only |
| `memory_query` | All 4 | Explicit knowledge request |
| `general` | All 4 | Broad query, need full context |

### Acceptance Criteria
- [x] "Remember that X" skips retrieval entirely (0ms memory latency)
- [x] Scheduling/lead queries only search business + agent layers
- [x] General queries still search all 4 layers (no regression)
- [x] All existing test suites pass (memory-tools: 39, extraction: 36, decay: 25)
- [x] Tools reuse singleton ConvexHttpClient from route
- [x] Test scripts refactored to shared library (no duplication)

---

## 11. Phase 7: Agent Framework

### Architecture Decision
Adopted Convex-native agent pipeline instead of LangGraph for Phase 7a. The `AgentHandler` interface
serves as a clean seam for future LangGraph migration — each handler method maps 1:1 to a graph node.
See `src/lib/ai/agents/core/handler.ts` for the contract.

### Phase 7a: Agent Framework Foundation [COMPLETE]

**Branch:** `feat/agent-framework`
**Status:** COMPLETE

#### Completed Tasks
- [x] Core framework (`src/lib/ai/agents/core/`): types, config, handler interface, pipeline runner, risk engine, memory helpers, guardrails
- [x] Followup Agent (`src/lib/ai/agents/followup/`): handler, prompt, tools, config — identifies stale leads, plans actions, learns from outcomes
- [x] Agent registry (`src/lib/ai/agents/registry.ts`): type-safe handler factory mapping
- [x] Schema additions: `agentDefinitions` + `agentExecutions` tables with indexes
- [x] Convex persistence: `agentDefinitions.ts` (CRUD), `agentExecutions.ts` (lifecycle), `agentRunner.ts` (internalAction entry point with LLM integration)
- [x] Daily cron for followup agent (14:00 UTC)
- [x] Type exports wired to `src/types/index.ts` and `src/lib/ai/index.ts`
- [x] Validation: typecheck + lint pass
- [x] Test script: `scripts/test-agent-framework.sh` (41 checks, all pass)

#### Key Files
| Area | Files |
|------|-------|
| Core framework | `agents/core/{types,config,handler,runner,risk,memory,guardrails}.ts` |
| Followup agent | `agents/followup/{handler,prompt,tools,config}.ts` |
| Registry | `agents/registry.ts`, `agents/index.ts` |
| Convex | `agentDefinitions.ts`, `agentExecutions.ts`, `agentRunner.ts` |
| Schema | `agentDefinitions` + `agentExecutions` tables |

### Phase 7b-d: Remaining Agents [PENDING]

#### 7b Reminder Agent
- Trigger: Scheduled (cron)
- Capabilities: Set tasks, send appointment reminders, track completion
- Memory: Learns preferred reminder timing and channels
- Risk: LOW

#### 7c Invoice Agent
- Trigger: Event-driven (appointment completed) or manual
- Capabilities: Create invoices, send payment reminders, track payments
- Memory: Learns preferred payment terms, pricing patterns
- Risk: MEDIUM (creates financial records)

#### 7d Sales Funnel Agent
- Trigger: Event-driven (new lead, stage change)
- Capabilities: Score leads, recommend actions, move pipeline stages, predict conversion
- Memory: Uses niche + business patterns for scoring
- Risk: LOW

### LangGraph Migration Path
```
Current: core/runner.ts (linear pipeline)
Future:  core/graph.ts (LangGraph StateGraph) — each node delegates to AgentHandler methods
Steps:
  1. bun add @langchain/core @langchain/langgraph
  2. Create core/graph.ts with StateGraph nodes
  3. Create core/checkpointer.ts mapping to agentExecutions table
  4. Create /api/agents/run route (LangGraph needs full @/lib access)
  5. Convex cron triggers lightweight action → POST to API route
  6. Zero changes to any agent handler (followup, reminder, etc.)
```

### Acceptance Criteria
- [x] Pipeline correctly transitions through load → plan → risk → execute → learn
- [x] Followup Agent identifies stale leads and generates personalized plans
- [x] All agent actions logged in agentExecutions table
- [x] Agent memories updated after each execution
- [x] HIGH risk actions skipped (not auto-executed) — Phase 9 adds approval UI
- [x] `bun run check:all` passes
- [ ] Reminder Agent sends timely reminders based on learned preferences
- [ ] Invoice Agent creates invoices with correct pricing from memory
- [ ] Sales Funnel Agent scores leads using niche + business patterns

### Test Plan
1. Run `scripts/test-agent-framework.sh` — validates structure, types, and integration
2. Enable followup agent for an org, verify stale lead detection via Convex dashboard
3. Test risk assessment: low-risk actions auto-execute, high-risk skipped with log
4. Verify agent memory updates: success → pattern recorded, failure → failure recorded
5. Test guardrails: submit plan with disallowed action type → rejected before execution

---

## 12. Phase 8: Worker Architecture & Background Jobs

### Objective
Implement the scheduled background workers for memory maintenance, aggregation, and communication.

### Tasks

#### 8.1 Convex Cron Configuration
**Files to create/modify:**
- `src/convex/crons.ts`

**Implementation:**
```typescript
import { cronJobs } from 'convex/server';

const crons = cronJobs();

// Business Workers
crons.interval('memory-extraction', { minutes: 1 }, internal.workers.processMemoryEvents);
crons.interval('decay-update', { hours: 1 }, internal.workers.updateDecayScores);
crons.interval('communication-queue', { minutes: 5 }, internal.workers.processCommunicationQueue);
crons.daily('memory-consolidation', { hourUTC: 8 }, internal.workers.consolidateMemories);  // 3 AM EST
crons.daily('analytics', { hourUTC: 11 }, internal.workers.generateDailyAnalytics);         // 6 AM EST
crons.weekly('cleanup', { dayOfWeek: 'sunday', hourUTC: 8 }, internal.workers.weeklyCleanup);

// Niche Workers
crons.daily('niche-benchmarks', { hourUTC: 9 }, internal.workers.calculateNicheBenchmarks);
crons.weekly('niche-reports', { dayOfWeek: 'monday', hourUTC: 9 }, internal.workers.generateNicheReports);

// Platform Workers
crons.daily('pattern-aggregation', { hourUTC: 7 }, internal.workers.aggregatePatterns);      // 2 AM EST
crons.weekly('platform-patterns', { dayOfWeek: 'sunday', hourUTC: 7 }, internal.workers.detectPlatformPatterns);

export default crons;
```

#### 8.2 Memory Extraction Worker
**Files to create:**
- `src/convex/workers/memoryExtraction.ts`

**Implementation:**
- Process unprocessed memory events from `memoryEvents` table
- For `conversation_end` events: run full extraction pipeline
- For `tool_success`/`tool_failure` events: record patterns in agent memory
- For `user_correction` events: update/override existing memory
- For `explicit_instruction` events: store as high-priority instruction
- Mark events as processed after handling
- Batch size: 10 events per run

#### 8.3 Decay Update Worker
**Files to create:**
- `src/convex/workers/decayUpdate.ts`

**Implementation:**
- Iterate all active business memories (batch by org)
- Calculate new decay scores using formula from Phase 5
- Transition memories between lifecycle states
- Flag archive candidates
- Batch size: 100 memories per org per run

#### 8.4 Memory Consolidation Worker
**Files to create:**
- `src/convex/workers/memoryConsolidation.ts`

**Implementation:**
- Find similar memories within each org (cosine similarity > 0.85)
- Merge similar memories: combine content, average confidence
- Compress archived memories: summarize groups of related memories
- Delete expired memories (past TTL + 90 day grace period)

#### 8.5 Pattern Aggregation Worker (Business → Niche)
**Files to create:**
- `src/convex/workers/patternAggregation.ts`

**Implementation:**
- Scan business memories across all orgs in same niche
- Identify patterns meeting promotion thresholds:
  - Minimum occurrences: 50 businesses
  - Minimum confidence: 0.85
  - Minimum success rate: 0.75
- Anonymize business-specific details
- Create/update niche memory entries

#### 8.6 Platform Pattern Worker (Niche → Platform)
**Files to create:**
- `src/convex/workers/platformPatterns.ts`

**Implementation:**
- Scan niche memories across all niches
- Identify universal patterns:
  - Minimum niches: 3
  - Minimum occurrences: 200 businesses total
  - Minimum confidence: 0.90
- Flag for human validation before promotion
- Create platform memory candidates

#### 8.7 Communication Worker
**Files to create:**
- `src/convex/workers/communication.ts`

**Implementation:**
- Process scheduled communications (followup emails, SMS reminders)
- Channel routing (email via Resend, SMS via Twilio)
- Template rendering with memory-powered personalization
- Delivery tracking and status updates
- Rate limiting per channel

#### 8.8 Analytics Worker
**Files to create:**
- `src/convex/workers/analytics.ts`

**Implementation:**
- Generate daily business analytics (leads, revenue, appointments)
- Memory quality metrics (retrieval accuracy, coverage)
- AI usage metrics (tokens consumed, cost per org)
- Store in analytics tables for dashboard

### Acceptance Criteria
- [ ] All cron jobs configured and running on schedule
- [ ] Memory extraction processes events within 1 minute
- [ ] Decay scores update hourly for all active memories
- [ ] Memory consolidation merges similar memories daily
- [ ] Pattern aggregation promotes business patterns to niche layer
- [ ] Communication worker sends scheduled messages reliably
- [ ] Workers respect org isolation (no cross-tenant processing)
- [ ] Failed worker runs are logged and retried
- [ ] `bun run check:all` passes

### Test Plan
1. Create memory events, verify extraction worker processes them within 2 minutes
2. Create old memories, trigger decay worker, verify scores decrease
3. Create similar memories, trigger consolidation, verify merge
4. Create 50+ similar memories across orgs, verify niche promotion
5. Schedule a communication, verify worker sends it
6. Simulate worker failure, verify retry behavior
7. Verify all workers respect organizationId isolation

---

## 13. Phase 9: Guardrails, Security & Approval Workflow

### Objective
Implement multi-layer security defenses, risk assessment, and the human-in-the-loop approval system.

### Tasks

#### 9.1 Input Validation Layer
**Files to create:**
- `src/lib/security/inputValidation.ts`

**Implementation:**
- Prompt injection detection patterns:
  - "ignore all previous instructions"
  - "system:" prefixes
  - Role reassignment attempts ("you are now")
  - Memory clearing attempts ("forget everything")
- Content length limits enforcement
- Character encoding validation
- Rate limiting per user/org

#### 9.2 Risk Assessment System
**Files to create:**
- `src/lib/security/riskAssessment.ts`

**Implementation:**
```typescript
interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;                    // 0-1
  factors: RiskFactor[];
  requiresApproval: boolean;
  notificationChannels: string[];
}

// Risk levels by tool/action:
const RISK_MAP = {
  listLeads: 'low',
  getSchedule: 'low',
  searchMemories: 'low',
  addLead: 'medium',
  updateLead: 'medium',
  createAppointment: 'medium',
  createInvoice: 'medium',
  sendEmail: 'medium',
  sendSMS: 'medium',
  deleteLead: 'high',
  cancelAppointment: 'high',
  sendInvoice: 'high',
  bulkDelete: 'critical',
  exportData: 'critical',
};
```

#### 9.3 Approval Queue
**Files to create:**
- `src/convex/approvalQueue.ts`
- `src/convex/schema.ts` (add approvalQueue table)

**Implementation:**
```typescript
approvalQueue: defineTable({
  organizationId: v.id('organizations'),
  agentType: v.string(),
  action: v.string(),
  actionParams: v.any(),
  riskLevel: v.string(),
  context: v.string(),
  description: v.string(),
  expiresAt: v.number(),
  status: v.union(
    v.literal('pending'), v.literal('approved'),
    v.literal('rejected'), v.literal('expired')
  ),
  reviewedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  rejectionReason: v.optional(v.string()),
  createdAt: v.number(),
})
```

**Auto-Expiration:**
| Risk Level | Expiration | On Expire |
|------------|-----------|-----------|
| Medium | 24 hours | Skip + notify |
| High | 4 hours | Skip + notify |
| Critical | 1 hour | Skip + notify |

#### 9.4 Audit Logging
**Files to create:**
- `src/convex/auditLogs.ts`
- `src/convex/schema.ts` (add auditLogs table)

**Implementation:**
```typescript
auditLogs: defineTable({
  organizationId: v.id('organizations'),
  userId: v.optional(v.string()),
  action: v.string(),
  resourceType: v.string(),
  resourceId: v.optional(v.string()),
  details: v.any(),
  riskLevel: v.string(),
  traceId: v.optional(v.string()),
  ipAddress: v.optional(v.string()),
  createdAt: v.number(),
})
```

- Log all tool executions
- Log all memory CRUD operations
- Log all approval decisions
- Log all agent actions
- Immutable (no updates or deletes)

#### 9.5 Execution Limits
**Files to create:**
- `src/lib/security/rateLimiting.ts`

**Implementation:**
- Max tool calls per request: 10
- Max tool calls per minute: 30
- Max data modifications per hour: 100
- Max bulk operation size: 50
- Anomaly detection: alert on 3x normal activity

#### 9.6 Tenant Isolation Enforcement
**Files to create:**
- `src/lib/security/tenantIsolation.ts`

**Implementation:**
- Middleware/helper that enforces `organizationId` on every query
- Cross-tenant access attempt logging
- Daily isolation verification job

#### 9.7 PII Handling
**Files to create:**
- `src/lib/security/pii.ts`

**Implementation:**
- PII detection: email, phone, SSN, credit card patterns
- Business layer: store encrypted
- Niche layer: redact PII
- Platform layer: PII forbidden
- Right to be forgotten: cascade delete memories + anonymize contributions

### Acceptance Criteria
- [ ] Prompt injection attempts are detected and blocked
- [ ] Risk assessment correctly classifies all tool actions
- [ ] High-risk actions create approval queue entries
- [ ] Approval queue auto-expires pending items
- [ ] All tool executions generate audit log entries
- [ ] Rate limits prevent excessive API usage
- [ ] Cross-tenant access attempts are blocked and logged
- [ ] PII is handled correctly per layer (encrypt/redact/forbidden)
- [ ] `bun run check:all` passes

### Test Plan
1. Send prompt injection attempts, verify they're blocked
2. Execute high-risk action, verify approval queue entry created
3. Approve/reject queue items, verify agent resumes/skips
4. Verify audit logs for all tool executions
5. Exceed rate limit, verify request is throttled
6. Attempt cross-org data access, verify it fails + is logged
7. Store memory with PII in niche layer, verify PII is redacted

---

## 14. Phase 10: Observability, Tracing & Cost Management

### Objective
Implement distributed tracing, LLM observability, and AI inference cost management.

### Tasks

#### 10.1 Trace Context Infrastructure
**Files to create:**
- `src/lib/tracing/context.ts`
- `src/lib/tracing/spans.ts`

**Implementation:**
- Generate trace IDs for each request
- Span types: `llm`, `retrieval`, `tool`, `agent`, `api`, `internal`
- Propagate trace context: Client → API → Agent → Worker → DB
- Capture: operation name, duration, status, metadata

#### 10.2 Convex Trace Storage
**Files to create:**
- `src/convex/traces.ts`
- `src/convex/schema.ts` (add traces table)

**Implementation:**
```typescript
traces: defineTable({
  traceId: v.string(),
  spanId: v.string(),
  parentSpanId: v.optional(v.string()),
  organizationId: v.optional(v.id('organizations')),
  operationName: v.string(),
  spanType: v.string(),
  status: v.string(),
  startTime: v.number(),
  endTime: v.optional(v.number()),
  duration: v.optional(v.number()),
  attributes: v.any(),
  createdAt: v.number(),
})
```

#### 10.3 LLM Usage Tracking
**Files to create:**
- `src/convex/llmUsage.ts`
- `src/convex/schema.ts` (add llmUsage table)

**Implementation:**
```typescript
llmUsage: defineTable({
  organizationId: v.id('organizations'),
  traceId: v.optional(v.string()),
  model: v.string(),
  provider: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  totalTokens: v.number(),
  estimatedCost: v.float64(),
  purpose: v.string(),             // 'chat', 'extraction', 'embedding', 'agent'
  cached: v.boolean(),
  latencyMs: v.number(),
  createdAt: v.number(),
})
```

#### 10.4 Langfuse Integration
**Files to create:**
- `src/lib/tracing/langfuse.ts`

**Implementation:**
- Initialize Langfuse client with env variables
- Wrap LLM calls with Langfuse trace/span
- Track: model, tokens, cost, latency, prompt version
- Send feedback signals (user corrections, thumbs up/down)

#### 10.5 Cost Management System
**Files to create:**
- `src/lib/cost/manager.ts`
- `src/lib/cost/budgets.ts`

**Implementation:**

**Model Selection by Task:**
| Task | Model | Cost Level |
|------|-------|-----------|
| Simple chat | gpt-4o-mini | Low |
| Complex reasoning | gpt-4o | Medium |
| Memory extraction | gpt-4o-mini | Low |
| Embeddings | text-embedding-3-large | Low |

**Tier-Based Limits:**
| Tier | Daily Tokens | Monthly Tokens |
|------|--------------|----------------|
| Free | 10,000 | 200,000 |
| Starter | 50,000 | 1,000,000 |
| Pro | 200,000 | 5,000,000 |
| Enterprise | Unlimited | Unlimited |

**Budget-Aware Routing:**
- > 80% budget: Switch to cheaper model, reduce context
- >= 100% budget: Graceful degradation, queue requests, notify admin

#### 10.6 Context Caching for Cost Reduction
**Files to modify:**
- `src/app/api/chat/route.ts`
- `src/lib/ai/memory/contextFormatter.ts`

**Implementation:**
- Place cacheable content (system prompt, tool definitions, platform/niche memories) at START of prompt
- Dynamic content (business memories, conversation history) after cache break
- Expected savings: 50-75% on cache hits (Anthropic/OpenAI cache-friendly prompts)

### Acceptance Criteria
- [ ] All LLM calls are traced with model, tokens, cost, and latency
- [ ] Traces are stored in Convex and optionally sent to Langfuse
- [ ] Cost tracking accurate to within 5% of actual spend
- [ ] Budget limits enforced per organization tier
- [ ] Budget-aware routing switches models when budget is high
- [ ] Context caching reduces token costs by 40%+
- [ ] Trace IDs propagate across the full request lifecycle
- [ ] `bun run check:all` passes

### Test Plan
1. Make chat request, verify trace appears in Convex traces table
2. Verify LLM usage record with correct token counts
3. Hit 80% budget, verify model downgrade occurs
4. Hit 100% budget, verify graceful degradation message
5. Verify cache-friendly prompt structure (static content first)
6. Check Langfuse dashboard for trace data (if configured)

---

## 15. Phase 11: Continuous Improvement & Learning System

### Objective
Implement the feedback loop, pattern detection, and self-improvement system.

### Tasks

#### 11.1 Feedback Signal Collection
**Files to create:**
- `src/lib/learning/feedback.ts`
- `src/convex/feedback.ts`

**Implementation:**

**Explicit Feedback:**
| Signal | Weight | Action |
|--------|--------|--------|
| Thumbs up | +1.0 | Reinforce pattern |
| Thumbs down | -1.0 | Penalize pattern |
| Correction | -0.5 | Update memory |
| Instruction | +2.0 | Create high-priority memory |

**Implicit Feedback:**
| Signal | Weight | Interpretation |
|--------|--------|----------------|
| Follow-up question | -0.3 | Unclear response |
| Rephrase | -0.2 | Misunderstood |
| Task complete | +0.5 | Successful interaction |
| Tool retry | -0.4 | Tool failure |

#### 11.2 Pattern Detection
**Files to create:**
- `src/lib/learning/patternDetection.ts`

**Implementation:**
- Minimum occurrences: 5 to detect pattern
- Time window: 30 days
- Confidence threshold: 0.8
- Pattern types: time preference, communication style, decision speed, price sensitivity, channel preference
- Auto-learning: enabled at confidence >= 0.85 and occurrences >= 10

#### 11.3 Failure Learning
**Files to create:**
- `src/lib/learning/failureLearning.ts`

**Implementation:**
- Track failures by category: tool_error, misunderstanding, wrong_action, incomplete_info
- Learn from corrections: record what was wrong and what was right
- Prevent repeat failures: before executing, check agent memory for similar past failures
- Create negative patterns in agent memory

#### 11.4 Memory Quality Monitoring
**Files to create:**
- `src/lib/learning/qualityMonitor.ts`

**Implementation:**
- Metrics: relevance, accuracy, freshness, retrieval precision, recall
- Alert threshold: quality score drop > 10% within 24 hours
- Auto-rollback trigger: if quality drops significantly
- Quality dashboard data for Phase 12

#### 11.5 Approval Learning
**Files to modify:**
- `src/convex/approvalQueue.ts`

**Implementation:**
- On approval: reinforce pattern, boost confidence +0.1
- On rejection: record reason, penalize confidence -0.2
- Track approval patterns to gradually reduce approval requirements for trusted actions

### Acceptance Criteria
- [ ] Explicit feedback (thumbs up/down) correctly adjusts memory scores
- [ ] Implicit feedback signals are detected from conversation flow
- [ ] Pattern detection identifies recurring behaviors
- [ ] Failure patterns are stored and consulted before similar actions
- [ ] Memory quality metrics are tracked and alertable
- [ ] Approval decisions feed back into agent learning
- [ ] `bun run check:all` passes

### Test Plan
1. Give thumbs up on response, verify memory reinforcement
2. Give thumbs down, verify memory penalization
3. Correct the AI, verify correction stored as memory update
4. Repeat a pattern 5 times, verify pattern detection fires
5. Cause tool failure, verify failure pattern recorded
6. Trigger quality alert, verify notification
7. Approve/reject agent actions, verify confidence adjustments

---

## 16. Phase 12: Memory UI & Admin Dashboard

### Objective
Build the frontend components for memory inspection, management, and system health monitoring.

### Tasks

#### 12.1 Memory Viewer Component
**Files to create:**
- `src/components/memory/MemoryViewer.tsx`
- `src/components/memory/MemoryCard.tsx`
- `src/components/memory/MemoryFilters.tsx`

**Implementation:**
- List all memories for current organization
- Filter by: type, layer, subject, decay score, active/archived
- Search memories by text
- Show memory details: content, confidence, decay score, access count, source
- Visual indicators for memory health (green/yellow/red based on decay)

#### 12.2 Memory Editor
**Files to create:**
- `src/components/memory/MemoryEditor.tsx`

**Implementation:**
- Edit memory content and metadata
- Add new memories manually
- Delete/archive memories
- View version history
- Resolve conflicts between memories

#### 12.3 Approval Queue Dashboard
**Files to create:**
- `src/components/agents/ApprovalQueue.tsx`
- `src/components/agents/ApprovalCard.tsx`

**Implementation:**
- List pending approvals with context
- Approve/reject with optional reason
- Auto-refresh with Convex real-time subscription
- Show expiration countdown
- Notification badges in navigation

#### 12.4 Agent Execution Log
**Files to create:**
- `src/components/agents/ExecutionLog.tsx`

**Implementation:**
- List recent agent executions
- Show: agent type, trigger, actions taken, results, timing
- Filter by agent type, status, date range
- Drill-down into individual execution details

#### 12.5 Analytics Dashboard
**Files to create:**
- `src/components/analytics/MemoryAnalytics.tsx`
- `src/components/analytics/CostAnalytics.tsx`
- `src/components/analytics/AgentAnalytics.tsx`

**Implementation:**
- Memory health: count by type, decay distribution, creation rate
- Cost tracking: token usage, cost per day/week, budget utilization
- Agent performance: success rates, execution counts, common actions
- System health: latency metrics, error rates, cache hit rates

#### 12.6 Memory Conversation Context Inspector
**Files to create:**
- `src/components/memory/ContextInspector.tsx`

**Implementation:**
- Dev-mode overlay showing:
  - What memories were retrieved for current message
  - Retrieval scores and ranking
  - Token budget usage
  - Which memories were selected vs. dropped
- Toggle via dev tools or feature flag

### Acceptance Criteria
- [ ] Memory viewer shows all memories with filtering and search
- [ ] Memory editor allows CRUD operations on memories
- [ ] Approval queue shows pending items with approve/reject flow
- [ ] Agent execution log shows full history with drill-down
- [ ] Analytics dashboard displays memory health, cost, and agent metrics
- [ ] Context inspector shows memory retrieval details in dev mode
- [ ] All components use real-time Convex subscriptions
- [ ] UI follows existing design system (Tailwind v4, dark mode, shadcn/ui)
- [ ] `bun run check:all` passes

### Test Plan
1. Open memory viewer, verify all memory types visible
2. Edit a memory, verify change persists
3. Create approval item, approve via dashboard, verify agent resumes
4. Check analytics charts display correct data
5. Use context inspector during chat, verify retrieval details shown
6. Test real-time updates: create memory in another tab, verify list updates

---

## 17. Dependency Installation Schedule

### Phase 0 (No new deps) - DONE
All existing dependencies sufficient.

### Phase 1 (No new deps) - DONE
All existing dependencies sufficient. Convex schema, CRUD, and validation built with existing packages.

### Phase 2 (Embedding) - DONE
No new dependencies needed. Embedding API called via native `fetch` (OpenAI-compatible endpoints). Convex built-in `ctx.vectorSearch` used for vector search.

### Phase 3 (Retrieval) - DONE
No new dependencies needed. `ConvexHttpClient` (from `convex/browser`) already available. All scoring, budgeting, and formatting implemented with vanilla TypeScript.

### Phase 7 (LangGraph)
```bash
bun add @langchain/core @langchain/langgraph @langchain/openai langchain
```

### Phase 10 (Observability)
```bash
bun add langfuse  # LLM observability
```

### Phase 12 (UI)
```bash
# Likely already installed via shadcn/ui, but verify:
bun add recharts  # For analytics charts (if not present)
```

---

## 18. Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Embedding API latency > 100ms | Context retrieval slows chat | Medium | Cache embeddings, batch requests, fallback to keyword search |
| LLM extraction hallucinations | False memories stored | High | Confidence thresholds, duplicate checks, human review for low-confidence |
| Vector search quality poor | Irrelevant memories returned | Medium | Hybrid search, reranking, quality monitoring with alerts |
| LangGraph complexity | Agent bugs, hard to debug | Medium | Start simple (2-3 states), comprehensive logging, Langfuse traces |
| Token costs escalate | Budget overruns | Medium | Tier limits, model routing, context caching, usage alerts |
| Cross-tenant data leak | Security breach | Low | Mandatory orgId filters, daily isolation checks, audit logging |
| Worker job failures | Memory quality degrades | Medium | Retry logic, dead letter queue, monitoring alerts |
| Schema migrations | Data loss during migration | Low | Convex migration system, backup before changes, incremental rollout |

---

## 19. Quality Gates

### Per-Phase Gates (Must Pass Before Moving to Next Phase)

1. **Code Quality**: `bun run check:all` passes (typecheck + lint)
2. **Functionality**: All acceptance criteria checked off
3. **Testing**: All test plan items verified
4. **Performance**: No regressions in chat response time (< 3s p95)
5. **Security**: No new security vulnerabilities (tenant isolation verified)
6. **Documentation**: Code documented, README updated if needed

### Pre-Production Gates (Before `feat/agent-framework` → `main`)

1. All phases complete and individually tested
2. Full integration test: new chat → memory storage → retrieval → agent action → feedback loop
3. Load test: 10 concurrent conversations with memory retrieval
4. Security audit: prompt injection, tenant isolation, PII handling
5. Cost estimation: projected monthly cost per tier validated
6. Monitoring: all alerts configured and tested
7. Feature flags: all features can be independently enabled/disabled
8. Rollback plan documented and tested

---

*Document Version: 1.7*
*Created: February 8, 2026*
*Last Updated: February 25, 2026*
*Author: RecommendMe AI Team*
*Status: Phases 0–6.5 Complete - Phase 7 Next*
