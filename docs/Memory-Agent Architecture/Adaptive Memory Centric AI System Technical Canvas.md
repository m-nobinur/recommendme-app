# Adaptive Memory‑Centric AI System

This document compiles the **full system canvas** for a production‑grade, research‑driven AI platform with adaptive long‑term memory, agent runtime, observability, and cost‑efficient inference. It is intended to be implementation‑ready and future‑scalable.

> **Status**: Phases 0–4 complete. Memory extraction pipeline operational.
> **Updated**: February 19, 2026

---

## 1. Memory Layers

### 1.1 Working Memory

- **Purpose:** Active reasoning and short‑term context
- **Scope:** Session / task
- **Lifetime:** Minutes
- **Storage:** Convex (TTL‑based)
- **Notes:** Never summarized, never vectorized

### 1.2 Episodic Memory

- **Purpose:** Record of events, interactions, decisions
- **Scope:** Timeline‑based
- **Lifetime:** Long‑term (archivable)
- **Storage:** Convex
- **Notes:** Source of traceability and audits

### 1.3 Semantic Memory

- **Purpose:** Facts, beliefs, rules, preferences
- **Scope:** Cross‑session
- **Lifetime:** Long‑term, decay‑aware
- **Storage:** Convex (structured)
- **Notes:** Conflict‑aware, confidence‑scored

### 1.4 Vector Memory

- **Purpose:** Semantic retrieval
- **Scope:** Knowledge recall
- **Lifetime:** Long‑term
- **Storage:** Convex vector indexes (3072 dims via text-embedding-3-large, pluggable later)
- **Notes:** Retrieval score weighted by decay strength; hybrid RRF search combines vector + keyword

### 1.5 Distilled Memory

- **Purpose:** Compressed long‑term knowledge
- **Scope:** System‑level
- **Lifetime:** Very long
- **Storage:** Convex
- **Notes:** Generated via summarization jobs

---

## 2. Adaptiveness

Adaptiveness is achieved through:

- Automatically
- Reinforcement on access
- Feedback‑driven confidence updates
- Event‑driven decay acceleration
- Conflict resolution between beliefs

Memory strength evolves as a function of:

- time
- usage
- importance
- feedback

---

## 3. Memory Awareness & Efficiency

The system is **memory‑aware**:

- Memory has cost, relevance, and confidence
- Not all memory is retrieved
- Retrieval is planned, not greedy

Efficiency mechanisms:

- Decay‑based pruning
- Summarization into distilled memory
- Vector recall only when needed

---

## 4. Context Optimization & Context Engineering

### Context Design Principles

- Minimal but sufficient
- Deterministic selection
- Cost‑bounded

### Techniques Used

- Sliding window (working memory)
- Semantic recall (semantic + vector)
- Episodic recall (time‑bounded)
- Distilled summaries
- Token budgeting before inference

---

## 5. System Design & Rules

### Prompt Design

- System prompt = policies + role
- Task prompt = user intent
- Context prompt = selected memory only

### Tool Design

- Tools are typed and deterministic
- Tool outputs are traceable
- Tool results can generate memory events

### Memory Rules

- No blind memory writes
- Every memory has a source trace
- Memory must justify its existence

---

## 5.5 Memory Extraction Pipeline (IMPLEMENTED)

The extraction pipeline is the core of the learning system. It processes memory events asynchronously to extract structured knowledge.

### Architecture

```
Chat Route (onFinish)
  ├─ Emit conversation_end event (memoryEvents table)
  ├─ Emit tool_success/tool_failure events (per tool call)
  └─ Non-blocking (uses after() callback)

Cron Job (every 2 min) ─── src/convex/crons.ts
  └─ processExtractionBatch ─── src/convex/memoryExtraction.ts
       ├─ Fetch unprocessed events (FIFO, batch of 5)
       ├─ For conversation_end:
       │    ├─ Fetch messages (internalQuery, up to 30)
       │    ├─ Fetch existing memories for dedup context
       │    ├─ Call gpt-4o-mini with extraction prompt
       │    ├─ Parse JSON, validate each item
       │    ├─ Dedup: vector search ≥ 0.92 → version bump or skip
       │    ├─ Create businessMemories + agentMemories + relations
       │    └─ Auto-generate embeddings for new memories
       ├─ For tool_success/tool_failure:
       │    ├─ Map tool → agent type (e.g., addLead → crm)
       │    ├─ Summarize outcome via LLM (100 tokens)
       │    └─ Create agent memory (success/failure pattern)
       └─ Mark events as processed (with retry window for failures)
```

### Components

| Component | File | Type |
|-----------|------|------|
| Extraction Worker | `src/convex/memoryExtraction.ts` | internalAction + internalMutations + internalQueries |
| Prompt & Schemas | `src/lib/ai/memory/extractionPrompt.ts` | Zod schemas + prompt builder |
| Cron Trigger | `src/convex/crons.ts` | Convex cron config |
| Event Emission | `src/app/api/chat/route.ts` | Next.js API route (onFinish) |
| Event Storage | `src/convex/memoryEvents.ts` | Convex mutations/queries |

### Validation Gates

All extracted items pass validation before storage:
- Content: 10-500 characters
- Confidence: 0.5-1.0
- Importance: 0.0-1.0
- Type: must match valid enum values
- Dedup: vector similarity < 0.92 to create new; ≥ 0.92 with higher confidence to version

---

## 6. Fast Memory Retrieval & Learning During Chat

### Retrieval Flow

1. Analyze query intent
2. Decide memory types needed
3. Query Convex (cached)
4. Assemble context

### Learning While Chatting

- Reinforce accessed memory
- Update confidence in real‑time
- Capture corrections immediately

---

## 7. Adaptive Learning & Automatic Improvement

### Feedback Sources

- Explicit user feedback
- Implicit success/failure
- Corrections
- Task completion signals

### Effects

- Confidence adjustment
- Importance recalibration
- Decay rate tuning
- Training data generation

---

## 8. Decay Algorithm

### Core Formula

```
strength = confidence × importance × e^(−decayRate × age)
```

### Properties

- Usage reinforces memory
- Low‑confidence memory decays faster
- Conflicts accelerate decay

### Thresholds

- Below threshold → archive or delete
- Episodic memory archived, not erased

---

## 9. Improvement Over Time

The system improves via:

- Memory consolidation
- Conflict resolution
- Feedback loops
- Periodic summarization

No blind fine‑tuning. Memory evolves first.

---

## 10. Guardrails & Security

- Tenant‑isolated memory
- Role‑based memory access
- PII tagging and redaction
- Audit logs via episodic memory
- Memory deletion & compliance policies

---

## 11. AI Inference Cost Management

### Cost Controls

- Token budget planner
- Memory relevance scoring
- Cached responses when safe
- Model selection per task

### Intelligent Decisions

- Cheap model for planning
- Expensive model for execution only
- Avoid redundant LLM calls

---

## 12. Scalability & Future Readiness

Designed for:

- Redis hot memory (future)
- External vector DB swap
- Multi‑agent scaling
- Multi‑tenant enterprise use

Memory model remains unchanged as infra evolves.

---

## 13. Agent Runtime & Background Infrastructure

### Agent Types

- Planner Agent
- Memory Manager Agent
- Executor Agents
- Evaluator / Trainer Agent

### Execution Environment

- Convex actions
- Convex background jobs
- Scheduled cron tasks

Agents are **logical constructs**, not servers.

---

## 14. Convex Components & Official Add‑ons Mapping (Production Usage)

This section maps **official Convex components** (from convex.dev/components) to concrete responsibilities in this system. This ensures we fully leverage Convex instead of re‑building infrastructure.

---

### 14.1 Convex Database (Core)

Used for:

- All memory layers (working, episodic, semantic, distilled)
- Vector metadata & references
- Traces, feedback, cost metrics
- Agent state & task state

Why:

- Strong consistency
- Automatic caching
- Reactive invalidation

---

### 14.2 Queries

Used for:

- Memory retrieval
- Context assembly
- Vector search lookups
- Cost estimation reads

Rules:

- Read‑only
- Cache‑friendly
- Deterministic

---

### 14.3 Mutations

Used for:

- Memory writes
- Confidence & decay updates
- Feedback ingestion
- Trace persistence

Rules:

- No heavy computation
- Every mutation has a trace ID

---

### 14.4 Actions

Used for:

- LLM calls (via Vercel AI SDK)
- Context planning
- LangGraph execution
- Tool orchestration

Why:

- External API access
- Multi‑step coordination

---

### 14.5 Vector Search Component

Used for:

- Semantic memory recall
- Context enrichment
- Similar interaction retrieval

Why:

- Native Convex integration
- No extra infra for MVP
- Deterministic + permission‑aware

Notes:

- Abstract behind interface for future Pinecone/Weaviate swap

---

### 14.6 Search Component

Used for:

- Keyword‑based episodic lookup
- Audit & trace exploration
- Admin & debugging tools

Complements vector search (not replaces it).

---

### 14.7 Scheduler Component

Used for:

- Deferred memory writes
- Post‑response learning updates
- Async confidence recalculation

Why:

- Keeps chat latency low
- Enables eventual consistency patterns

---

### 14.8 Cron Component

Used for:

- **Memory extraction pipeline** (ACTIVE — every 2 minutes)
- Daily decay execution (planned)
- Weekly summarization (planned)
- Periodic archival (planned)
- Cost & usage aggregation (planned)

This is where **memory hygiene** lives. Currently only the extraction cron is active (`src/convex/crons.ts`).

---

### 14.9 File Storage Component

Used for:

- Long‑term artifacts
- Evaluation datasets
- Training exports
- Conversation snapshots

Avoids bloating core tables.

---

### 14.10 Auth Component

Used for:

- Multi‑tenant isolation
- Role‑based memory access
- Enterprise readiness

Memory access always flows through auth context.

---

### 14.11 HTTP Actions

Used for:

- Webhooks (billing, events)
- Offline evaluation runners
- External integrations

Never expose raw memory directly.

---

### 14.12 Convex Caching (Implicit but Critical)

Used for:

- Hot memory reads
- Context assembly
- Repeated semantic queries

Why Redis is optional initially:

- Convex queries are cached automatically
- Invalidated deterministically
- Much simpler mental model

Redis can be introduced later only for cross‑region or ultra‑low‑latency needs.

---



### Queries

Used for:

- Memory retrieval (semantic, episodic, vector)
- Context assembly
- Read‑only agent planning steps

Rules:

- No side effects
- Must be cheap and cacheable

---

### Mutations

Used for:

- Writing memory
- Updating confidence / decay metadata
- Storing feedback
- Recording traces

Rules:

- Every mutation must be traceable
- No heavy computation

---

### Actions

Used for:

- LLM calls
- Agent orchestration
- Context planning
- Tool execution

Why:

- Can call external APIs
- Can coordinate multiple queries + mutations

---

### Background Jobs

Used for:

- Memory decay execution
- Periodic summarization
- Memory consolidation
- Cost analytics

---

### Cron Jobs

Currently active:

- **Memory extraction** (every 2 min) — `processExtractionBatch`

Planned:

- Daily decay pass
- Weekly summarization
- Archival & cleanup

---

## 15. Vercel AI SDK Integration

### Role in the System

Vercel AI SDK is the **inference and streaming layer**, not the brain.

Used for:

- Streaming responses
- Tool calling interface
- Model abstraction

### Flow

1. Client sends request
2. Server Action invokes Convex Action
3. Convex Action prepares context
4. AI SDK streams response back

Key rule:

> AI SDK never talks directly to memory — Convex does.

---

## 16. LangChain / LangGraph Usage

### LangChain (Optional, Tactical)

Use **sparingly** for:

- Tool abstractions
- Prompt templates
- Output parsers

Avoid:

- LangChain memory modules
- Hidden state

---

### LangGraph (Recommended for Agents)

LangGraph is ideal for:

- Agent state machines
- Multi‑step reasoning
- Planner → Executor → Evaluator loops

Integration model:

- LangGraph runs inside Convex Actions
- State persisted explicitly in Convex

---

## 17. Tooling Ecosystem

### Tracing & Observability

- Langfuse (external)
- Convex trace tables (internal)

### Evaluation

- Human feedback UI
- Automatic heuristics
- Trace replay

### Future Training

- Traces → datasets
- Fine‑tuning later, optional

---

## 18. End‑to‑End Request Lifecycle

```
User → Next.js → Server Action
     → Convex Action
     → Context Planning (queries)
     → LLM (AI SDK)
     → Streaming Response
     → Feedback / Trace Write
```

---

## Final Principle

> Memory is not storage. Memory is a living belief system.

Convex is the **spine** of this system. LLMs are **tools**, not the architecture.

---

## Implementation Status (February 2026)

| Phase | Component | Status |
|-------|-----------|--------|
| 0 | Prerequisites & Message Persistence | **DONE** |
| 1 | Memory Schema & CRUD (4-layer hierarchy) | **DONE** |
| 2 | Embedding Service & Vector Search | **DONE** |
| 3 | Memory Retrieval Pipeline & Context Builder | **DONE** |
| 4 | Memory Extraction Pipeline & Cron | **DONE** |
| 5 | Decay Algorithm & Memory Lifecycle | Planned |
| 6 | Memory Tools & Chat Integration | Planned |
| 7 | Agent Framework (LangGraph) | Planned |
| 8 | Worker Architecture & Background Jobs | Planned |
| 9 | Guardrails, Security & Approval | Planned |
| 10 | Observability, Tracing & Cost | Planned |
| 11 | Continuous Improvement & Learning | Planned |
| 12 | Memory UI & Admin Dashboard | Planned |

