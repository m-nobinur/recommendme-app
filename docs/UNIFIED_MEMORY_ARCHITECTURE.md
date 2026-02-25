# RecommendMe Unified Architecture

> Comprehensive Technical Specification for AI Agent Memory Architecture & System Design

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Memory Layer Architecture](#3-memory-layer-architecture)
4. [Multi-Layer Database Design](#4-multi-layer-database-design)
5. [Adaptiveness & Learning System](#5-adaptiveness--learning-system)
6. [Memory Awareness & Efficiency](#6-memory-awareness--efficiency)
7. [Context Engineering & Optimization](#7-context-engineering--optimization)
8. [Fast Memory Retrieval](#8-fast-memory-retrieval)
9. [Decay Algorithm](#9-decay-algorithm)
10. [Agent Architecture](#10-agent-architecture)
11. [Worker Architecture](#11-worker-architecture)
12. [Prompt & Tool Design](#12-prompt--tool-design)
13. [Memory Rules & Governance](#13-memory-rules--governance)
14. [Continuous Improvement System](#14-continuous-improvement-system)
15. [Guardrails & Security](#15-guardrails--security)
16. [AI Inference Cost Management](#16-ai-inference-cost-management)
17. [Tracing & Observability](#17-tracing--observability)
18. [Communication Channels](#18-communication-channels)
19. [Scalability Architecture](#19-scalability-architecture)
20. [Technology Evaluation](#20-technology-evaluation)
21. [Implementation Roadmap](#21-implementation-roadmap)
22. [Deployment Architecture](#22-deployment-architecture)

---

## 1. Executive Summary

### Vision

Build a production-grade, hierarchical memory system that serves as RecommendMe's competitive MOAT. The system enables AI agents to:

- **Learn** from every interaction across the platform
- **Remember** business context with perfect tenant isolation
- **Adapt** to individual business patterns and preferences
- **Improve** automatically through feedback loops
- **Scale** efficiently from MVP to millions of businesses

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Hierarchical Inheritance** | Knowledge flows down: Platform → Niche → Business → Agent |
| **Tenant Isolation** | Zero data leakage between businesses |
| **Real-Time Sync** | Memory updates propagate instantly across sessions |
| **Cost Efficiency** | Smart caching, compression, and retrieval minimize LLM costs |
| **Graceful Degradation** | System remains functional even when memory subsystems fail |

### Key Metrics Targets

| Metric | Target |
|--------|--------|
| Memory retrieval latency | < 100ms p95 |
| Context injection overhead | < 500 tokens average |
| Token cost reduction | 40-60% vs full-context approach |
| Memory accuracy | > 95% relevance for retrieved context |
| Tenant isolation | 100% (zero cross-tenant access) |

---

## 2. Architecture Overview

### 2.1 High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    PLATFORM LEVEL                                                │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                             │ │
│  │  ┌──────────────┐      ┌──────────────────────┐      ┌──────────────────────┐             │ │
│  │  │  Master DB   │◀────▶│   Platform Router    │◀────▶│  Platform State      │             │ │
│  │  │  (Global)    │      │   + Niche Knowledge  │      │  Store               │             │ │
│  │  └──────────────┘      └──────────────────────┘      └──────────────────────┘             │ │
│  │                                    │                                                       │ │
│  └────────────────────────────────────┼───────────────────────────────────────────────────────┘ │
│                                       │                                                         │
│                          ┌────────────┴────────────┐                                           │
│                          ▼                         ▼                                           │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                     WORKER LEVEL                                                 │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                             │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    ┌────────────────────────────────────────────┐  │ │
│  │  │  State   │ │  State   │ │  State   │    │            NICHE SERVICES                  │  │ │
│  │  │  Memory  │ │  Tool    │ │  Worker  │    │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘    │  │  Niche   │ │  Niche   │ │  Niche   │   │  │ │
│  │       │            │            │          │  │  Agent   │ │  Reports │ │   DB     │   │  │ │
│  │       └────────────┴────────────┘          │  └──────────┘ └──────────┘ └──────────┘   │  │ │
│  │                    │                       │       │             │            │         │  │ │
│  │                    ▼                       │       └─────────────┴────────────┘         │  │ │
│  │  ┌─────────────────────────────────────────┴────────────────────────────────────────┐   │ │
│  │  │                        WRITE LEVEL (Convex Actions)                               │   │ │
│  │  └───────────────────────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                                           │ │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                                         │
│                    ┌──────────────────┼──────────────────┐                                     │
│                    ▼                  ▼                  ▼                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                    BUSINESS LEVEL                                                │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                             │ │
│  │  ┌─────────────────────────────┐    ┌─────────────────────────────┐    ┌─────────────────┐ │ │
│  │  │       BUSINESS A            │    │       BUSINESS B            │    │   BUSINESS N    │ │ │
│  │  │  ┌───────────┬───────────┐  │    │  ┌───────────┬───────────┐  │    │                 │ │ │
│  │  │  │ Business  │ Business  │  │    │  │ Business  │ Business  │  │    │      ...        │ │ │
│  │  │  │ Memory    │ Worker    │  │    │  │ Memory    │ Worker    │  │    │                 │ │ │
│  │  │  │ (DB)      │ (Exec)    │  │    │  │ (DB)      │ (Exec)    │  │    │                 │ │ │
│  │  │  └───────────┴───────────┘  │    │  └───────────┴───────────┘  │    │                 │ │ │
│  │  │           │                 │    │           │                 │    │                 │ │ │
│  │  │           ▼                 │    │           ▼                 │    │                 │ │ │
│  │  │  ┌───────────────────────┐  │    │  ┌───────────────────────┐  │    │                 │ │ │
│  │  │  │      AI AGENTS        │  │    │  │      AI AGENTS        │  │    │                 │ │ │
│  │  │  │ CRM│Follow│Invoice│   │  │    │  │ CRM│Follow│Invoice│   │  │    │                 │ │ │
│  │  │  │ Sales│Reminder        │  │    │  │ Sales│Reminder        │  │    │                 │ │ │
│  │  │  └───────────────────────┘  │    │  └───────────────────────┘  │    │                 │ │ │
│  │  └─────────────────────────────┘    └─────────────────────────────┘    └─────────────────┘ │ │
│  │                                                                                             │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                                         │
│                    ┌──────────────────┴──────────────────┐                                     │
│                    ▼                                     ▼                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                  SUPPORTING SYSTEMS                                              │
│  ┌────────────────────────────────────┐    ┌────────────────────────────────────────────────┐  │
│  │        TRANSACTIONAL               │    │              ANALYTICS                          │  │
│  │  ┌──────────┐ ┌──────────────────┐ │    │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │  Email   │ │ Phone+Text+Alerts│ │    │  │   AI     │ │ Reports  │ │ Analytics    │   │  │
│  │  │  (Resend)│ │ (Twilio)         │ │    │  │ Recos    │ │ + Chat   │ │ Logs         │   │  │
│  │  └──────────┘ └──────────────────┘ │    │  └──────────┘ └──────────┘ └──────────────┘   │  │
│  └────────────────────────────────────┘    └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Layer Responsibilities

| Layer | Responsibility | Database Scope | Worker Scope |
|-------|---------------|----------------|--------------| 
| **Platform** | Global config, cross-niche patterns, routing | Master DB (shared) | Platform-wide jobs |
| **Worker (Niche)** | Industry-specific knowledge, shared tools | Niche DB (per industry) | Niche-level processing |
| **Business** | Customer data, business logic, agents | Business DB (isolated) | Per-business execution |
| **Supporting** | Communication, analytics, logging | Shared services | Background services |

### 2.3 Component Responsibilities

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| **Memory Service** | CRUD, retrieval, extraction, consolidation | Convex functions |
| **Embedding Service** | Generate 3072-dim embeddings (text-embedding-3-large) | OpenRouter / OpenAI API |
| **Context Builder** | Assemble prompts, manage token budget | TypeScript lib |
| **Extraction Pipeline** | LLM-powered memory extraction from conversations | Convex internalAction + cron |
| **Agent Router** | Dispatch to appropriate agent, orchestrate | Convex actions |
| **Tool Executor** | Validate and execute CRM tools | Convex mutations |
| **Background Worker** | Run scheduled jobs, consolidation | Convex crons |

---

## 3. Memory Layer Architecture

### 3.1 Four-Layer Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PLATFORM MEMORY (Layer 1)                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Scope: All businesses, all niches                                    │   │
│  │ Content: Universal best practices, proven patterns                   │   │
│  │ Update: Weekly aggregation (anonymized)                              │   │
│  │ Access: READ-ONLY for all lower layers                               │   │
│  │ Examples: "Follow-up within 24-48 hours increases conversion 23%"    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                          Inherits universal patterns                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      NICHE MEMORY (Layer 2)                          │   │
│  │ Scope: All businesses in same industry                               │   │
│  │ Content: Industry terminology, service patterns, pricing norms       │   │
│  │ Update: Daily aggregation from niche businesses                      │   │
│  │ Access: Shared within niche, inherits Platform                       │   │
│  │ Examples: "Deep cleaning avg: 3-4 hours", "Limo: 2hr advance book"   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                          Inherits niche patterns                            │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    BUSINESS MEMORY (Layer 3)                         │   │
│  │ Scope: Single organization only                                      │   │
│  │ Content: Customer prefs, pricing, services, communication style      │   │
│  │ Update: REAL-TIME with every interaction                             │   │
│  │ Access: Isolated by organizationId, inherits Niche                   │   │
│  │ Examples: "10% repeat discount", "John prefers morning appointments" │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                         Provides business context                           │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      AGENT MEMORY (Layer 4)                          │   │
│  │ Scope: Per agent type per organization                               │   │
│  │ Content: Execution patterns, learned preferences, success/failure    │   │
│  │ Update: After each agent action                                      │   │
│  │ Access: Agent-specific within organization                           │   │
│  │ Examples: "User prefers detailed notes", "Default: Net 30 terms"     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Memory Types Per Layer

| Type | Description | Layer(s) | TTL |
|------|-------------|----------|-----|
| **Fact** | Verified information about entities | All | 180 days |
| **Preference** | User/business preferences | Business, Agent | 90 days |
| **Instruction** | Explicit rules from user | Business, Agent | Never |
| **Context** | Situational awareness | Business | 30 days |
| **Relationship** | Entity connections | Business | 180 days |
| **Pattern** | Learned behavioral patterns | Niche, Platform | 365 days |
| **Episodic** | Interaction summaries | Business | 90 days |

### 3.3 Memory Schema Components

**Platform Memory** (Admin managed, read-only for tenants):
- Category (sales, scheduling, pricing, communication, followup)
- Content and embedding (3072 dims)
- Confidence score and source count
- Validation timestamp

**Niche Memory** (Shared within industry vertical):
- Niche identifier
- Category and content with embedding
- Contributor count and confidence

**Business Memory** (Per organization, tenant-isolated):
- Organization and user scope
- Type (fact, preference, instruction, context, relationship)
- Subject type and ID for entity linking
- Importance, access count, decay score
- Expiration and source metadata

**Agent Memory** (Per agent type per organization):
- Agent type identifier
- Category (pattern, preference, success, failure)
- Use count and success rate
- Last used timestamp

**Memory Relations** (Lightweight knowledge graph):
- Source and target entity types/IDs
- Relation type (prefers, related_to, leads_to, requires, conflicts_with)
- Strength and evidence

---

## 4. Multi-Layer Database Design

### 4.1 Database Isolation Strategy

Since Convex is a single database system, logical multi-database isolation is implemented through:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           CONVEX DATABASE - LOGICAL ISOLATION                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ PLATFORM TABLES (No tenant filter - admin only)                            │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   │
│ │ platform_     │ │ platform_     │ │ niches        │ │ platform_     │   │
│ │ memories      │ │ config        │ │               │ │ analytics     │   │
│ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ NICHE TABLES (Filter by nicheId)                                           │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   │
│ │ niche_        │ │ niche_        │ │ niche_        │ │ niche_        │   │
│ │ memories      │ │ templates     │ │ patterns      │ │ reports       │   │
│ │ [nicheId]     │ │ [nicheId]     │ │ [nicheId]     │ │ [nicheId]     │   │
│ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ BUSINESS TABLES (Strict organizationId isolation)                          │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   │
│ │ business_     │ │ leads         │ │ appointments  │ │ invoices      │   │
│ │ memories      │ │ [orgId]       │ │ [orgId]       │ │ [orgId]       │   │
│ │ [orgId]       │ │               │ │               │ │               │   │
│ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   │
│ │ messages      │ │ agent_        │ │ conversations │ │ agent_        │   │
│ │ [orgId]       │ │ memories      │ │ [orgId]       │ │ executions    │   │
│ │               │ │ [orgId]       │ │               │ │ [orgId]       │   │
│ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Database Hierarchy

**1. PLATFORM LAYER (Master DB)**
- Scope: Global / Universal
- Content: Platform Memories (read-only for tenants), Global Configurations, System Prompts, User/Org Registry
- Implementation: Global Convex Tables (e.g., `platformMemories`, `globalSettings`)

**2. NICHE LAYER (Niche DB)**
- Scope: Industry Vertical
- Content: Niche Memories (shared within niche), Industry Patterns, Niche-specific Templates
- Implementation: Partitioned Tables by Niche ID

**3. BUSINESS LAYER (Business DB)**
- Scope: Tenant / Organization
- Content: Business Memories (Strict Isolation), Agent Memories, CRM Data, Conversation History
- Implementation: Logical Sharding by `organizationId`
- Safety: Row-Level Security (RLS) via Convex authorization policies

### 4.3 Key Tables by Layer

| Layer | Tables | Isolation |
|-------|--------|-----------| 
| **Platform** | platformConfig, platformMemories, niches, platformAnalytics | Admin only |
| **Niche** | nicheMemories, nicheTemplates, nichePatterns, nicheReports | nicheId filter |
| **Business** | All CRM tables, businessMemories, agentMemories, conversations, messages | organizationId filter |
| **System** | agentDefinitions, agentExecutions, approvalQueue, traces, llmUsage, auditLogs | Mixed |

### 4.4 Data Access Patterns

All queries to business-level tables **MUST** include organizationId filter:
- Platform-level: Admin only, no tenant filter
- Niche-level: Filtered by nicheId
- Business-level: Strict organizationId isolation enforced at query level

---

## 5. Adaptiveness & Learning System

### 5.1 Continuous Improvement Loop

```
┌──────────────────────────────────────────────────────────────────────┐
│                    CONTINUOUS IMPROVEMENT LOOP                        │
└──────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│   OBSERVE     │           │    LEARN      │           │    ADAPT      │
│               │           │               │           │               │
│ • Conversation│──────────▶│ • Extract     │──────────▶│ • Update      │
│   monitoring  │           │   memories    │           │   prompts     │
│ • Tool usage  │           │ • Pattern     │           │ • Adjust      │
│   tracking    │           │   detection   │           │   weights     │
│ • Outcome     │           │ • Success/    │           │ • Modify      │
│   recording   │           │   failure     │           │   behavior    │
│ • User        │           │   analysis    │           │ • Update      │
│   feedback    │           │               │           │   priorities  │
└───────────────┘           └───────────────┘           └───────────────┘
        │                           │                           │
        └───────────────────────────┴───────────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────┐
                        │     EVALUATE      │
                        │                   │
                        │ • Memory quality  │
                        │ • Retrieval       │
                        │   accuracy        │
                        │ • User            │
                        │   satisfaction    │
                        │ • Cost            │
                        │   efficiency      │
                        └───────────────────┘
```

### 5.2 Learning Triggers

| Trigger | Action | Memory Layer |
|---------|--------|--------------|
| Conversation ends | Extract facts, preferences, instructions | Business |
| Tool execution success | Record successful pattern | Agent |
| Tool execution failure | Record failure pattern, learn | Agent |
| User correction | Update/override existing memory | Business |
| Explicit instruction | Store as high-priority rule | Business |
| Approval granted | Reinforce pattern positively | Agent |
| Approval rejected | Penalize pattern, learn reason | Agent |
| Pattern threshold reached | Promote to higher layer | Niche/Platform |

### 5.3 Memory Extraction Pipeline

```
User Message ──▶ LLM Analysis ──▶ Entity Extraction ──▶ Deduplication ──▶ Store
                     │                    │                   │
                     ▼                    ▼                   ▼
              ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
              │ Identify:    │    │ Extract:     │    │ Check:       │
              │ • Facts      │    │ • Entities   │    │ • Similarity │
              │ • Prefs      │    │ • Relations  │    │   ≥ 0.92?    │
              │ • Rules      │    │ • Attributes │    │ • Merge or   │
              │ • Context    │    │              │    │   create new │
              │ • Episodic   │    │              │    │ • Version    │
              └──────────────┘    └──────────────┘    └──────────────┘

Implementation (Phase 4 - COMPLETE):
  • Worker: src/convex/memoryExtraction.ts (processExtractionBatch)
  • Prompt: src/lib/ai/memory/extractionPrompt.ts (Zod schemas + buildExtractionPrompt)
  • Trigger: src/convex/crons.ts (every 2 min)
  • Events: src/app/api/chat/route.ts (conversation_end, tool_success, tool_failure)
  • LLM: gpt-4o-mini via OpenRouter/OpenAI (structured JSON output)
  • Dedup: Vector search ≥ 0.92 similarity → version bump or skip
  • Validation: Content 10-500 chars, confidence 0.5-1.0, importance 0-1.0
```

**Extraction Rules:**
- Only extract NEW information not in existing memories
- Assign confidence based on explicitness (explicit=0.95, inferred=0.7)
- Mark conflicts with existing memories

### 5.4 Pattern Recognition & Promotion

**Business to Niche Promotion Thresholds:**
- Minimum occurrences: 50 (seen in 50+ businesses)
- Minimum confidence: 0.85 (85% confidence average)
- Minimum success rate: 0.75 (75% success rate)
- Anonymization required: Strip business-specific details

**Niche to Platform Promotion Thresholds:**
- Minimum niches: 3 (seen in 3+ niches)
- Minimum occurrences: 200 (seen in 200+ businesses total)
- Minimum confidence: 0.90 (90% confidence)
- Human validation required

---

## 6. Memory Awareness & Efficiency

### 6.1 Memory-Aware Context Assembly

**Token Budget Allocation:**
| Section | Tokens | Purpose |
|---------|--------|---------|
| Total | 4000 | Max tokens for memory context |
| Platform | 200 | Universal patterns |
| Niche | 300 | Industry knowledge |
| Business | 2000 | Business-specific (highest priority) |
| Agent | 500 | Agent patterns |
| Relations | 500 | Entity relationships |
| Conversation | 500 | Recent conversation summary |

**Priority Weights for Retrieval Ranking:**
| Factor | Weight |
|--------|--------|
| Relevance Score | 0.4 (semantic similarity) |
| Importance Score | 0.25 (stored importance value) |
| Recency Score | 0.2 (how recently accessed/created) |
| Access Frequency | 0.15 (how often used) |

### 6.2 Smart Loading Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SMART LOADING PIPELINE                         │
└─────────────────────────────────────────────────────────────────────┘

Step 1: Query Analysis
┌──────────────────────────────────────────────────────────────────────┐
│ User Query: "Schedule a cleaning for John next Tuesday"              │
│                                                                      │
│ Detected Intents: [scheduling, customer_lookup]                      │
│ Detected Entities: [John (customer), next Tuesday (date)]            │
│ Required Context: [customer_preferences, scheduling_rules, services] │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Step 2: Targeted Retrieval (Parallel)
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Platform    │ Niche       │ Business    │ Agent       │
│ Query:      │ Query:      │ Query:      │ Query:      │
│ scheduling  │ cleaning    │ John prefs  │ scheduling  │
│ best        │ scheduling  │ scheduling  │ patterns    │
│ practices   │ norms       │ rules       │             │
└─────────────┴─────────────┴─────────────┴─────────────┘
                                    │
                                    ▼
Step 3: Result Merging & Ranking
┌──────────────────────────────────────────────────────────────────────┐
│ Combined Results (ranked by composite score):                        │
│ 1. [Business] John prefers morning appointments (score: 0.94)        │
│ 2. [Business] Standard cleaning: 2-3 hours (score: 0.89)             │
│ 3. [Agent] User typically confirms via text (score: 0.85)            │
│ 4. [Niche] Allow 30min buffer between cleanings (score: 0.78)        │
│ 5. [Platform] Confirm appointments 24h in advance (score: 0.72)      │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Step 4: Token Budget Fitting
┌──────────────────────────────────────────────────────────────────────┐
│ Selected (within 2000 token budget):                                 │
│ • John prefers morning appointments                                  │
│ • Standard cleaning: 2-3 hours                                       │
│ • User typically confirms via text                                   │
│ • Allow 30min buffer between cleanings                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.3 Caching Strategy

| Cache Level | Scope | TTL | Content | Storage |
|-------------|-------|-----|---------|---------|
| **L1** | Request | Request lifetime | Embeddings, retrieved memories | In-memory |
| **L2** | Conversation | 30 minutes | Conversation summary, active memories | Convex real-time subscription |
| **L3** | Organization | 24 hours | Frequently accessed memories, embeddings | Convex with cache invalidation |

---

## 7. Context Engineering & Optimization

### 7.1 Context Window Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    CONTEXT WINDOW STRUCTURE                            │
│                       (Target: 8K tokens)                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ SYSTEM PROMPT (Fixed ~800 tokens)                                │  │
│  │ • Role definition                                                 │  │
│  │ • Capabilities                                                    │  │
│  │ • Behavior guidelines                                             │  │
│  │ • Output format rules                                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ MEMORY CONTEXT (Dynamic ~2000 tokens)                            │  │
│  │ ┌────────────────────────────────────────────────────────────┐   │  │
│  │ │ Business Rules & Instructions (High Priority)              │   │  │
│  │ │ • Explicit user instructions                               │   │  │
│  │ │ • Business-specific rules                                  │   │  │
│  │ └────────────────────────────────────────────────────────────┘   │  │
│  │ ┌────────────────────────────────────────────────────────────┐   │  │
│  │ │ Relevant Context (Query-Specific)                          │   │  │
│  │ │ • Customer information                                     │   │  │
│  │ │ • Service details                                          │   │  │
│  │ │ • Recent interactions                                      │   │  │
│  │ └────────────────────────────────────────────────────────────┘   │  │
│  │ ┌────────────────────────────────────────────────────────────┐   │  │
│  │ │ Patterns & Best Practices (Lower Priority)                 │   │  │
│  │ │ • Niche patterns                                           │   │  │
│  │ │ • Platform best practices                                  │   │  │
│  │ └────────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ CONVERSATION HISTORY (Sliding Window ~3000 tokens)               │  │
│  │ • Recent messages (full detail)                                  │  │
│  │ • Older messages (summarized)                                    │  │
│  │ • Tool calls and results                                         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ CURRENT TURN (~2000 tokens reserved)                             │  │
│  │ • User message                                                    │  │
│  │ • Tool results (if any)                                          │  │
│  │ • Assistant response generation                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Conversation Compression Strategy

**Recent Messages:**
- Keep last 6 messages in full
- Format: Complete content

**Older Messages:**
- Summarize every 10 messages
- Target: 200 tokens per summary
- Retain tool calls in summary

**Archive Strategy:**
- Threshold: 50 messages before archiving
- Extract memories to long-term storage
- Keep conversation summary

### 7.3 Context Caching (Cost Optimization)

**Static Prompt Caching** (Anthropic/OpenAI compatible):
- Enabled for: system_prompt, tool_definitions, platform_memories, niche_memories
- Place cacheable content at START of prompt
- Expected savings: 50-75% on cache hits

**Prompt Structure:**
```
[CACHED - System Prompt]
[CACHED - Tool Definitions]
[CACHED - Platform/Niche Context]
---cache-break---
[DYNAMIC - Business Memories]
[DYNAMIC - Conversation History]
[DYNAMIC - Current Turn]
```

---

## 8. Fast Memory Retrieval

### 8.1 Retrieval Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FAST MEMORY RETRIEVAL PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────┘

Query: "Schedule a cleaning for John next Tuesday"
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: QUERY ANALYSIS (< 5ms)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ Intent Detection: [scheduling, customer_lookup]                             │
│ Entities: [John → customer, next Tuesday → date]                            │
│ Required Context: [customer_prefs, scheduling_rules, services]              │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: EMBEDDING GENERATION (< 50ms)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ Model: text-embedding-3-large (3072 dims)                                   │
│ Batch: [query_embedding, entity_embeddings]                                 │
│ Cache: Check L2 cache first                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: PARALLEL VECTOR SEARCH (< 30ms total)                               │
├───────────────┬───────────────┬───────────────┬─────────────────────────────┤
│ Platform      │ Niche         │ Business      │ Agent                       │
│ (k=5)         │ (k=10)        │ (k=20)        │ (k=10)                      │
│ filter: none  │ filter: niche │ filter: orgId │ filter: orgId + agentType   │
│ ~10ms         │ ~10ms         │ ~15ms         │ ~10ms                       │
└───────────────┴───────────────┴───────────────┴─────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: ENTITY-SPECIFIC LOOKUP (< 10ms)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ Direct lookup: customer "John" → get all memories with subjectId=john_id    │
│ Relation lookup: john_id → related entities → preferences                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: SCORING & RANKING (< 5ms)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ Combined Score = 0.4 * relevance + 0.25 * importance + 0.2 * recency        │
│                + 0.15 * access_frequency                                    │
│                                                                             │
│ Layer Weights: platform=0.5, niche=0.7, business=1.0, agent=0.8             │
│ Recency Boost: memories < 7 days get 1.2x boost                             │
│ Access Boost: frequently accessed memories get up to 1.1x boost             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: TOKEN BUDGET FITTING (< 2ms)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Budget: 2000 tokens                                                         │
│ Selected: Top memories that fit within budget                               │
│ Strategy: Greedy selection by score until budget exhausted                  │
└─────────────────────────────────────────────────────────────────────────────┘

Total Latency Target: < 100ms p95
```

### 8.2 Retrieval Optimization Techniques

**Query Expansion:**
- Technique: Hypothetical Document Embedding (HyDE)
- Fallback: Keyword extraction

**Two-Stage Retrieval:**
- Stage 1: Vector search (k=50, min similarity 0.5)
- Stage 2: Reranking with cross-encoder or LLM (k=10 final)

**Hybrid Search:**
- Vector weight: 0.7
- Keyword weight: 0.3 (fields: content, subjectType)
- Fusion: Reciprocal rank

**Pre-computation:**
- Pre-compute embeddings for common queries
- Pre-compute entity clusters
- Cache frequently accessed memories (hot memory cache)

### 8.3 Real-Time Learning During Chat

| Trigger | Processing | Priority |
|---------|-----------|----------|
| Message complete | Extract and store memories | Async (low) - don't block response |
| Memory retrieved | Increment access count | Sync (immediate) |
| Tool complete | Record pattern, update success rate, detect preferences | Async |
| User correction | Update memory, increase confidence, propagate correction | Sync |

---

## 9. Decay Algorithm

> **Status: IMPLEMENTED** — `src/lib/ai/memory/decay.ts`, `src/convex/memoryDecay.ts`, `src/lib/ai/memory/ttl.ts`

### 9.1 Exponential Forgetting Curve

Based on the Ebbinghaus forgetting curve adapted for AI memory:

```
Memory Strength = e^(-λ * t / (1 + r))

Where:
  λ = base decay rate (0.1 for facts, 0.2 for context)
  t = time since creation or last access (in days)
  r = reinforcement factor (access count * success rate)
```

### 9.2 Decay Parameters

**Base Decay Rates by Memory Type:**
| Type | Decay Rate | Description |
|------|-----------|-------------|
| Instruction | 0.01 | Very slow decay (explicit rules) |
| Fact | 0.05 | Slow decay |
| Preference | 0.08 | Medium decay |
| Pattern | 0.10 | Medium decay |
| Context | 0.15 | Faster decay |
| Episodic | 0.20 | Fastest decay |

**Reinforcement Factors:**
| Factor | Value | Description |
|--------|-------|-------------|
| Access Boost | +0.1 | Per access |
| Success Boost | +0.2 | Per successful use |
| Correction Penalty | -0.3 | If corrected/overridden |
| Explicit Refresh | +1.0 | User explicitly references |

**Thresholds:**
| State | Decay Score Range | Behavior |
|-------|-------------------|----------|
| Active | > 0.7 | Actively used, full retrieval priority |
| Accessible | 0.3 - 0.7 | Can be retrieved with lower priority |
| Archive | 0.1 - 0.3 | Archive candidate, compress/summarize |
| Delete | < 0.1 | Deletion candidate |

### 9.3 Memory Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MEMORY LIFECYCLE                                        │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌───────────────────────────────────────┐
                    │           MEMORY CREATED              │
                    │         decayScore = 1.0              │
                    └───────────────────┬───────────────────┘
                                        │
                    ┌───────────────────▼───────────────────┐
                    │              ACTIVE                   │
                    │         decayScore > 0.7              │
                    │   • Full retrieval priority           │
                    │   • Regular access tracking           │
                    └───────────────────┬───────────────────┘
                                        │
                         (decay over time, no access)
                                        │
                    ┌───────────────────▼───────────────────┐
                    │            ACCESSIBLE                 │
                    │       0.3 < decayScore < 0.7          │
                    │   • Lower retrieval priority          │
                    │   • Access can boost back to active   │
                    └───────────────────┬───────────────────┘
                                        │
                         (continued decay, no access)
                                        │
                    ┌───────────────────▼───────────────────┐
                    │             ARCHIVE                   │
                    │       0.1 < decayScore < 0.3          │
                    │   • Compress/summarize                │
                    │   • Only retrieve if explicitly       │
                    │     relevant                          │
                    └───────────────────┬───────────────────┘
                                        │
                         (continued decay, no access)
                                        │
                    ┌───────────────────▼───────────────────┐
                    │             EXPIRED                   │
                    │          decayScore < 0.1             │
                    │   • Soft delete                       │
                    │   • Purge after retention period      │
                    └───────────────────────────────────────┘

                    ─────────────────────────────────────────
                    Note: Any access/use at any stage boosts
                    decayScore and can move memory back to
                    higher lifecycle stages
                    ─────────────────────────────────────────
```

---

## 10. Agent Architecture

### 10.1 Agent System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      AGENT SYSTEM                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

                              ┌────────────────────────────┐
                              │      AGENT TRIGGERS        │
                              │                            │
                              │  • Scheduled (cron)        │
                              │  • Event-driven (webhook)  │
                              │  • User-initiated          │
                              │  • System-triggered        │
                              └─────────────┬──────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    AGENT ROUTER                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Load agent configuration                                                                  │ │
│  │ • Validate organization access                                                              │ │
│  │ • Check budget/quotas                                                                       │ │
│  │ • Route to appropriate agent                                                                │ │
│  │ • Initialize tracing context                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                         │
            ┌───────────────┬────────────┼────────────┬───────────────┐
            ▼               ▼            ▼            ▼               ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   CRM AGENT   │  │FOLLOWUP AGENT │  │ INVOICE AGENT │  │ SALES FUNNEL  │  │REMINDER AGENT │
├───────────────┤  ├───────────────┤  ├───────────────┤  ├───────────────┤  ├───────────────┤
│ Capabilities: │  │ Capabilities: │  │ Capabilities: │  │ Capabilities: │  │ Capabilities: │
│ • Add/update  │  │ • Schedule    │  │ • Create      │  │ • Score leads │  │ • Set tasks   │
│   leads       │  │   followups   │  │   invoices    │  │ • Recommend   │  │ • Send        │
│ • Track       │  │ • Send emails │  │ • Send        │  │   actions     │  │   reminders   │
│   contacts    │  │ • Send SMS    │  │   reminders   │  │ • Move stages │  │ • Track       │
│ • Manage      │  │ • Personalize │  │ • Track       │  │ • Predict     │  │   completion  │
│   pipeline    │  │   content     │  │   payments    │  │   conversion  │  │               │
│               │  │               │  │               │  │               │  │               │
│ Risk: LOW     │  │ Risk: MEDIUM  │  │ Risk: MEDIUM  │  │ Risk: LOW     │  │ Risk: LOW     │
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
```

### 10.2 Hierarchical Agent Architecture (Global-Middle-Worker Model)

**LEVEL 1: GLOBAL AGENTS (Strategic Orchestration)**
- Role: High-level decision making, LLM integration, Strategy
- Components:
  - Master Agent: Coordinates cross-domain tasks
  - Decision Agent: Determines intent and routes requests
  - AI Agent: Interfaces with LLM models (System 2 thinking)

**LEVEL 2: MIDDLEWARE (Business Logic & Routing)**
- Role: API handling, Context assembly, Tenant routing
- Components:
  - Agent Router: Dispatches tasks to specific agents
  - Context Builder: Assembles memory context
  - API Gateway: Handles auth and rate limiting

**LEVEL 3: WORKERS (Task Execution)**
- Role: Atomic operations, Database interaction, Background jobs
- Components:
  - Business Worker: CRUD operations (CRM, Invoices)
  - Niche Worker: Aggregation tasks
  - AI Worker: Background memory processing
  - Master Worker: Cron scheduling and maintenance

### 10.3 Agent Execution Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                      AGENT EXECUTION PIPELINE                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

TRIGGER ─────────────────────────────────────────────────────────────────────────────────────────▶

    │
    ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 1. LOAD     │───▶│ 2. PLAN     │───▶│ 3. RISK     │───▶│ 4. EXECUTE  │
│ CONTEXT     │    │ ACTIONS     │    │ ASSESS      │    │ OR QUEUE    │
│             │    │             │    │             │    │             │
│ • Agent     │    │ • Analyze   │    │ • Evaluate  │    │ • LOW: auto │
│   memory    │    │   situation │    │   each      │    │ • MED: notify│
│ • Business  │    │ • Determine │    │   action    │    │ • HIGH: wait │
│   context   │    │   actions   │    │ • Aggregate │    │   approval  │
│ • Relevant  │    │ • Prioritize│    │   risk      │    │             │
│   data      │    │             │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                                │
                                                                ▼
                                        ┌─────────────────────────────────────┐
                                        │         5. POST-EXECUTION           │
                                        │                                     │
                                        │ • Log actions to audit trail        │
                                        │ • Update agent memory               │
                                        │ • Send notifications                │
                                        │ • Schedule follow-ups               │
                                        │ • Learn from outcome                │
                                        └─────────────────────────────────────┘
```

### 10.4 Approval Workflow

**Approval Queue Structure:**
- Organization and agent type
- Pending action with risk level
- Context and description
- Expiration timestamp
- Status (pending, approved, rejected, expired)

**Notification Channels:**
| Risk Level | Channels |
|------------|----------|
| Medium | In-app only |
| High | In-app + Email |
| Critical | In-app + Email + SMS |

**Auto-Expiration:**
| Risk Level | Expiration Time | On Expire |
|------------|-----------------|-----------|
| Medium | 24 hours | Notify and skip |
| High | 4 hours | Notify and skip |
| Critical | 1 hour | Notify and skip |

**Learning from Decisions:**
- Approved: Reinforce pattern, boost confidence +0.1
- Rejected: Record rejection, ask reason, penalize confidence -0.2

---

## 11. Worker Architecture

### 11.1 Worker Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    WORKER ARCHITECTURE                                           │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PLATFORM WORKERS (Run globally, no tenant context)                                              │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐                   │
│ │ Memory Aggregation   │  │ Pattern Detection    │  │ Analytics Rollup     │                   │
│ │ Worker               │  │ Worker               │  │ Worker               │                   │
│ │                      │  │                      │  │                      │                   │
│ │ • Promote business   │  │ • Identify patterns  │  │ • Aggregate metrics  │                   │
│ │   patterns to niche  │  │   across niches      │  │ • Generate reports   │                   │
│ │ • Promote niche to   │  │ • Update platform    │  │ • Clean old data     │                   │
│ │   platform           │  │   memories           │  │                      │                   │
│ │                      │  │                      │  │                      │                   │
│ │ Schedule: Daily 2AM  │  │ Schedule: Weekly     │  │ Schedule: Hourly     │                   │
│ └──────────────────────┘  └──────────────────────┘  └──────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ NICHE WORKERS (Run per niche, access niche data)                                                │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐                   │
│ │ Niche Report         │  │ Template Update      │  │ Benchmark            │                   │
│ │ Generator            │  │ Worker               │  │ Calculator           │                   │
│ │                      │  │                      │  │                      │                   │
│ │ • Generate niche     │  │ • Update templates   │  │ • Calculate niche    │                   │
│ │   benchmarks         │  │   based on patterns  │  │   benchmarks         │                   │
│ │ • Industry insights  │  │ • A/B test content   │  │ • Compare business   │                   │
│ │                      │  │                      │  │   performance        │                   │
│ │                      │  │                      │  │                      │                   │
│ │ Schedule: Weekly     │  │ Schedule: Monthly    │  │ Schedule: Daily      │                   │
│ └──────────────────────┘  └──────────────────────┘  └──────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ BUSINESS WORKERS (Run per organization, strict isolation)                                       │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐                   │
│ │ Memory Consolidation │  │ Decay Update         │  │ Communication        │                   │
│ │ Worker               │  │ Worker               │  │ Worker               │                   │
│ │                      │  │                      │  │                      │                   │
│ │ • Merge similar      │  │ • Update decay       │  │ • Send scheduled     │                   │
│ │   memories           │  │   scores             │  │   emails/SMS         │                   │
│ │ • Compress old       │  │ • Archive/delete     │  │ • Process queue      │                   │
│ │   memories           │  │   expired            │  │                      │                   │
│ │                      │  │                      │  │                      │                   │
│ │ Schedule: Daily 3AM  │  │ Schedule: Hourly     │  │ Schedule: Every 5min │                   │
│ └──────────────────────┘  └──────────────────────┘  └──────────────────────┘                   │
│                                                                                                 │
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐                   │
│ │ Memory Extraction    │  │ Analytics            │  │ Cleanup              │                   │
│ │ Worker               │  │ Worker               │  │ Worker               │                   │
│ │                      │  │                      │  │                      │                   │
│ │ • Process conv queue │  │ • Generate daily     │  │ • Clean old traces   │                   │
│ │ • Extract memories   │  │   reports            │  │ • Archive old logs   │                   │
│ │   from conversations │  │ • Update dashboards  │  │ • Purge expired      │                   │
│ │                      │  │                      │  │                      │                   │
│ │ Schedule: Every 1min │  │ Schedule: Daily 6AM  │  │ Schedule: Weekly     │                   │
│ └──────────────────────┘  └──────────────────────┘  └──────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Worker Schedule Summary

| Worker | Schedule | Level | Status | Purpose |
|--------|----------|-------|--------|---------|
| **Memory Extraction** | **Every 2min** | **Business** | **ACTIVE** | **Process memoryEvents, extract memories from conversations and tool outcomes** |
| **Decay Update** | **Hourly** | **Business** | **ACTIVE** | **Recalculate decay scores for all active memories (`memoryDecay.ts`)** |
| **Memory Archival** | **Daily 8:00 UTC** | **Business** | **ACTIVE** | **Archive memories with score < 0.3, compress via LLM (`memoryArchival.ts`)** |
| **Memory Cleanup** | **Weekly Sun 8:00 UTC** | **Business** | **ACTIVE** | **Soft-delete expired, hard-delete old, clean orphan relations (`memoryArchival.ts`)** |
| Memory Aggregation | Daily 2AM | Platform | Planned | Promote patterns up |
| Pattern Detection | Weekly Sun | Platform | Planned | Cross-niche patterns |
| Analytics Rollup | Hourly | Platform | Planned | Aggregate metrics |
| Niche Reports | Weekly Mon | Niche | Planned | Industry reports |
| Benchmarks | Daily 4AM | Niche | Planned | Calculate benchmarks |
| Memory Consolidation | Daily 3AM | Business | Planned | Merge memories |
| Communication | Every 5min | Business | Planned | Send messages |
| Analytics | Daily 6AM | Business | Planned | Generate reports |

---

## 12. Prompt & Tool Design

### 12.1 System Prompt Architecture

**System Prompt Components:**
1. **Role Definition** - AI assistant identity and mission
2. **Capabilities Section** - What the agent can do
3. **Behavior Rules** - Professional, concise, proactive guidelines
4. **Business Context** - Business rules and instructions
5. **Memory Context** - Relevant knowledge from memory layers
6. **Session Context** - Current conversation state
7. **Constraints** - Security and privacy boundaries

### 12.2 Memory Context Injection Format

**Priority Ordering:**
1. **Business Rules (HIGH)** - Explicit user instructions, business-specific rules
2. **Customer Information** - Customer facts with confidence scores
3. **Service Context** - Service-related memories
4. **Learned Patterns** - Patterns with success rates
5. **Recent Interactions** - Summarized recent activity

### 12.3 Dynamic Prompt Adaptation

**Intent-Based Adaptation:**
| Intent | Emphasize | Primary Tools |
|--------|-----------|---------------|
| Scheduling | scheduling_rules, availability, customer_preferences | checkSchedule, createAppointment |
| Lead Management | lead_stages, qualification_criteria, follow_up_rules | addLead, updateLead, listLeads |
| Invoicing | pricing, payment_terms, customer_history | createInvoice, getInvoiceStatus |

**Experience-Based Adaptation:**
| User Type | Verbosity | Suggestions | Confirmations |
|-----------|-----------|-------------|---------------|
| New User | Detailed | Proactive | Explicit |
| Experienced | Concise | Minimal | Implicit |

### 12.4 Tool Categories

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           TOOL CATEGORIES                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│   CRM TOOLS         │  │   SCHEDULING TOOLS  │  │   FINANCE TOOLS     │
│   (Risk: LOW-MED)   │  │   (Risk: MEDIUM)    │  │   (Risk: MEDIUM)    │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│ • addLead           │  │ • checkAvailability │  │ • createInvoice     │
│ • updateLead        │  │ • createAppointment │  │ • getInvoices       │
│ • listLeads         │  │ • updateAppointment │  │ • sendInvoice       │
│ • searchLeads       │  │ • cancelAppointment │  │ • recordPayment     │
│ • deleteLead (HIGH) │  │ • getSchedule       │  │ • getBalance        │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ COMMUNICATION TOOLS │  │   MEMORY TOOLS      │  │   ANALYTICS TOOLS   │
│   (Risk: MEDIUM)    │  │   (Risk: LOW)       │  │   (Risk: LOW)       │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│ • sendEmail         │  │ • rememberFact      │  │ • getPipelineStats  │
│ • sendSMS           │  │ • forgetMemory      │  │ • getRevenueReport  │
│ • scheduleFollowup  │  │ • searchMemories    │  │ • getActivityLog    │
│ • getConversations  │  │ • updatePreference  │  │ • getConversionRate │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

### 12.5 Tool Execution Pipeline

```
Tool Call ──▶ Validate ──▶ Risk Check ──▶ Execute ──▶ Log ──▶ Learn
                │              │             │          │        │
                ▼              ▼             ▼          ▼        ▼
         ┌──────────┐   ┌──────────┐   ┌──────────┐  ┌────┐  ┌──────┐
         │ Schema   │   │ LOW:     │   │ Convex   │  │Audit│ │Update│
         │ validate │   │ Auto-run │   │ mutation │  │ log │  │agent │
         │          │   │ MED:     │   │          │  │     │  │memory│
         │ Sanitize │   │ Notify   │   │ Return   │  │     │  │      │
         │ input    │   │ HIGH:    │   │ result   │  │     │  │      │
         │          │   │ Approval │   │          │  │     │  │      │
         └──────────┘   └──────────┘   └──────────┘  └────┘  └──────┘
```

---

## 13. Memory Rules & Governance

### 13.1 Memory CRUD Rules

**Creation Permissions by Layer:**
| Layer | Who Can Create |
|-------|----------------|
| Platform | Admin only |
| Niche | Admin, system aggregation |
| Business | Owner, admin, AI extraction |
| Agent | System, AI learning |

**Validation Requirements:**
- Minimum content length: 10 characters
- Maximum content length: 500 characters
- Require confidence score
- Minimum confidence: 0.5
- Duplicate threshold: 0.92 cosine similarity

**Update Rules:**
- Conflict resolution: Newer wins with merge
- Version history: Keep up to 5 versions
- Require reason for explicit updates

**Deletion Rules:**
- Soft delete by default
- Hard delete after 90 days
- Audit log required
- Same permissions as creation

**Access Rules:**
- Cross-tenant access: FORBIDDEN
- Platform: All can read
- Niche: Same niche only
- Business: Same org only
- Agent: Same org + same agent type

### 13.2 Memory Quality Gates

**Pre-Storage Checks:**
1. Duplicate check (similar memory exists?)
2. Content validation (format valid?)
3. Confidence threshold (meets minimum?)
4. PII scan (sensitive data?)
5. Relevance check (relevant to business?)

**Pre-Promotion Checks:**
1. Occurrence threshold met
2. Confidence average acceptable
3. Success rate sufficient
4. Human review (for platform)
5. Anonymization complete

**Maintenance Checks:**
1. Staleness check (mark stale memories)
2. Contradiction scan (find conflicts)
3. Consolidation (merge similar)
4. Decay update (update scores)

### 13.3 Privacy & Compliance Rules

**PII Handling:**
| Memory Layer | PII Handling |
|--------------|--------------|
| Business | Store encrypted |
| Niche | Redact |
| Platform | Forbidden |

**Data Retention:**
| Data Type | Retention Period |
|-----------|-----------------|
| Default | 2 years |
| PII | 1 year |
| Deleted user data | 30 days |
| Audit logs | 7 years |

**Right to be Forgotten:**
- Memories: Cascade delete
- Conversations: Cascade delete
- Aggregated data: Anonymize (contributions to niche/platform)

---

## 14. Continuous Improvement System

### 14.1 Improvement Loop Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                 CONTINUOUS IMPROVEMENT ARCHITECTURE                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────┐      ┌────────────────┐      ┌────────────────┐
│    OBSERVE     │─────▶│     ANALYZE    │─────▶│     LEARN      │
│                │      │                │      │                │
│ • Conversation │      │ • Pattern      │      │ • Update       │
│   outcomes     │      │   detection    │      │   memories     │
│ • Tool success │      │ • Failure      │      │ • Adjust       │
│   rates        │      │   analysis     │      │   weights      │
│ • User         │      │ • Trend        │      │ • Promote      │
│   corrections  │      │   identification│     │   patterns     │
│ • Feedback     │      │                │      │                │
│   signals      │      │                │      │                │
└────────────────┘      └────────────────┘      └────────────────┘
         │                                               │
         │                                               │
         │              ┌────────────────┐               │
         │              │    EVALUATE    │               │
         └─────────────▶│                │◀──────────────┘
                        │ • A/B testing  │
                        │ • Quality      │
                        │   metrics      │
                        │ • Regression   │
                        │   detection    │
                        │ • Safety       │
                        │   checks       │
                        └────────────────┘
```

### 14.2 Signal Collection

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

**System Metrics:**
| Metric | Threshold | Signal |
|--------|-----------|--------|
| Response latency | > 3000ms | Performance issue |
| Retrieval accuracy | < 0.7 | Memory quality issue |
| Token efficiency | < 0.8 | Context optimization needed |

### 14.3 Pattern Detection & Learning

**Pattern Detection Parameters:**
- Minimum occurrences: 5 (see pattern at least 5 times)
- Time window: 30 days
- Confidence threshold: 0.8 (80% similar outcomes)

**Pattern Types:**
- Time preference (user prefers certain times)
- Communication style (formal vs casual)
- Decision speed (quick vs deliberate)
- Price sensitivity (budget conscious vs premium)
- Channel preference (email vs SMS vs call)

**Auto-Learning Thresholds:**
- Enabled with confidence ≥ 0.85 and occurrences ≥ 10
- Human review required for confidence ≥ 0.95

**Failure Learning:**
- Track failures by category: tool_error, misunderstanding, wrong_action, incomplete_info
- Learn from corrections
- Prevent repeat failures

### 14.4 Self-Improvement Safety

**Validation:**
- All new memories must pass validation
- All changes must be reversible (version control)
- Staged rollout for pattern changes

**Rollback Capabilities:**
- Track all changes in change log
- Auto-rollback trigger: Quality score drop > 10% within 24 hours
- Manual rollback always available

**Quality Monitoring:**
- Memory quality: relevance, accuracy, freshness
- Retrieval quality: precision, recall, latency
- Alert threshold: 0.8

---

## 15. Guardrails & Security

### 15.1 Multi-Layer Defense

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                     SECURITY DEFENSE LAYERS                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

Layer 1: INPUT VALIDATION
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ • Pattern-based injection detection                                                             │
│ • Content length limits                                                                         │
│ • Character encoding validation                                                                 │
│ • Rate limiting per user/org                                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Layer 2: PROMPT PROTECTION
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ • System prompt isolation                                                                       │
│ • Instruction hierarchy enforcement                                                             │
│ • Memory content sanitization                                                                   │
│ • Tool schema validation                                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Layer 3: EXECUTION SANDBOXING
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ • Tool allowlisting                                                                             │
│ • Parameter validation                                                                          │
│ • Resource quotas (time, memory, API calls)                                                     │
│ • Tenant isolation enforcement                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Layer 4: OUTPUT VERIFICATION
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ • PII detection and redaction                                                                   │
│ • Secret scanning                                                                               │
│ • Response policy compliance                                                                    │
│ • Audit logging                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 15.2 Prompt Injection Prevention

**Blocked Patterns:**
- "ignore all previous instructions"
- "system:" prefixes
- Role reassignment attempts ("you are now")
- Memory clearing attempts ("forget everything")

**Content Boundary Enforcement:**
- User content delimited with clear markers
- System content protection: immutable
- Memory content sanitization enabled

**Instruction Hierarchy (Priority Order):**
1. System prompt (highest)
2. Platform rules
3. Business rules
4. User input (lowest)

### 15.3 Tool Execution Guardrails

**Risk Levels and Actions:**
| Risk Level | Examples | Action | Logging | Rate Limit |
|------------|----------|--------|---------|------------|
| Low | listLeads, getSchedule, searchMemories | Auto-execute | Basic | - |
| Medium | addLead, updateLead, createAppointment, createInvoice | Execute + notify | Detailed | 100/hour |
| High | deleteLead, cancelAppointment, sendInvoice, processPayment | Require approval | Full audit | Notify owner |
| Critical | bulkDelete, exportData, modifySettings | Require explicit approval | Full audit + reason | 5min cooldown |

**Execution Limits:**
- Max tool calls per request: 10
- Max tool calls per minute: 30
- Max data modifications per hour: 100
- Max bulk operation size: 50

**Anomaly Detection Triggers:**
- Unusual volume (3x normal activity)
- Unusual timing (outside business hours)
- Unusual patterns (different from learned behavior)
- Rapid succession (too many calls too fast)
- Action: Pause and alert

### 15.4 Multi-Tenant Isolation

**Data Isolation:**
- Mandatory filter: organizationId on every query
- Enforcement level: Query rewrite
- Cross-tenant joins: Forbidden

**Memory Isolation:**
| Memory Type | Isolation Level |
|-------------|-----------------|
| Business | Strict org isolation |
| Agent | Strict org + agent type isolation |
| Niche | Niche-scoped (can see same niche) |
| Platform | Global read-only |

**Context Isolation:**
- Conversation: Org + user scoped
- Memory bleed: Prevented
- Session: User scoped

**Audit:**
- Log all cross-org access attempts (should be none)
- Regular isolation verification: Daily

---

## 16. AI Inference Cost Management

### 16.1 Cost Components

| Component | Unit Cost | Optimization Strategy |
|-----------|-----------|----------------------|
| LLM Input Tokens | $0.15-3.00/1M | Context compression, caching |
| LLM Output Tokens | $0.60-15.00/1M | Response length control |
| Embedding Generation | $0.02-0.13/1M | Batch processing, caching |
| Vector Search | ~$0.01/1K queries | Pre-filtering, caching |
| Storage | ~$0.25/GB/month | Compression, TTL cleanup |

### 16.2 Cost Optimization Strategies

**Model Selection by Task:**
| Task | Recommended Model | Cost Level |
|------|-------------------|------------|
| Simple query | gpt-4o-mini | Cheap, fast |
| Complex reasoning | gpt-4o | More expensive |
| Memory extraction | gpt-4o-mini (via OpenRouter) | Structured JSON extraction |
| Embeddings | text-embedding-3-large (3072 dims) | Higher quality, production-grade |

**Context Caching:**
- Static caching for: system_prompt, tool_definitions, platform_memories
- Provider: Anthropic cache or OpenAI cache
- Expected savings: 50-75%

**Token Budget Management:**
| Scope | Limit |
|-------|-------|
| Per request - max input | 8000 tokens |
| Per request - max output | 2000 tokens |
| Per request - memory context | 2000 tokens |
| Per org - daily | Tier-dependent |
| Per org - monthly | Tier-dependent |

**Tier-Based Limits:**
| Tier | Daily Tokens | Monthly Tokens |
|------|--------------|----------------|
| Free | 10,000 | 200,000 |
| Starter | 50,000 | 1,000,000 |
| Pro | 200,000 | 5,000,000 |
| Enterprise | Unlimited | Unlimited |

**Batch Processing:**
- Embeddings: Batch size 100, max wait 5 seconds
- Extraction: Process async, batch by conversation

### 16.3 Adaptive Cost Control

**Budget-Aware Routing:**
| Budget Usage | Actions |
|--------------|---------|
| > 80% | Switch to cheaper model, reduce context, increase caching |
| ≥ 100% | Graceful degradation, queue requests, notify admin |

**Quality vs Cost Tradeoff Presets:**
| Preference | Model | Context | Cost |
|------------|-------|---------|------|
| Quality | Best | Full | High |
| Balanced | Smart | Optimized | Medium |
| Economical | Fast | Minimal | Low |

**Default by Tier:**
- Free: Economical
- Starter: Balanced
- Pro: Quality

---

## 17. Tracing & Observability

### 17.1 Tracing Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              OBSERVABILITY ARCHITECTURE                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DATA SOURCES                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│   │   Chat API   │  │   Agents     │  │   Workers    │  │   Memory     │  │    Tools     │    │
│   │   Requests   │  │   Execution  │  │   Jobs       │  │   Operations │  │   Execution  │    │
│   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              OPENTELEMETRY COLLECTOR                                             │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│   Trace Context Example:                                                                        │
│                                                                                                 │
│   traceId: "abc123"                                                                             │
│   └── spanId: "span1" (api.chat)                                                                │
│       ├── spanId: "span2" (memory.retrieve)                                                     │
│       │   ├── spanId: "span3" (vector.search.platform)                                          │
│       │   ├── spanId: "span4" (vector.search.niche)                                             │
│       │   └── spanId: "span5" (vector.search.business)                                          │
│       ├── spanId: "span6" (llm.generate)                                                        │
│       │   └── attributes: {model, tokens_in, tokens_out, latency}                               │
│       ├── spanId: "span7" (tool.execute.addLead)                                                │
│       └── spanId: "span8" (memory.extract)                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
│       CONVEX DB          │  │       LANGFUSE           │  │     EXTERNAL             │
│   (Internal Storage)     │  │   (LLM Observability)    │  │   (DataDog/Grafana)      │
├──────────────────────────┤  ├──────────────────────────┤  ├──────────────────────────┤
│ • traces table           │  │ • LLM traces             │  │ • Infrastructure         │
│ • llmUsage table         │  │ • Prompt analysis        │  │ • APM                    │
│ • auditLogs table        │  │ • Cost tracking          │  │ • Alerting               │
│ • Custom dashboards      │  │ • Eval scores            │  │ • Long-term retention    │
└──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
```

### 17.2 Distributed Tracing Components

**Trace ID Propagation:** Client → API → Agent → Worker → DB

**Span Types:**
| Type | Description | Key Attributes |
|------|-------------|----------------|
| `llm` | LLM API calls | model, tokens, latency |
| `retrieval` | Memory/vector search | layer, count, latency |
| `tool` | Tool execution | name, status |
| `agent` | Agent execution | type, actions |
| `api` | API endpoints | method, status |
| `internal` | Internal operations | operation |

### 17.3 Metrics Collection

**Business Metrics:**
- Leads converted
- Invoices sent
- Revenue

**System Metrics:**
- API latency
- Error rates
- Worker queue depth

**AI Metrics:**
- Token consumption
- Cache hit rate
- Hallucination rate

### 17.4 Logging

**Structure:** JSON format with correlation

**Levels:** DEBUG, INFO, WARN, ERROR, AUDIT

**Correlation Tags:**
- traceId
- orgId
- userId

---

## 18. Communication Channels

### 18.1 Supported Channels

| Channel | Provider | Use Cases |
|---------|----------|-----------|
| Email | Resend | Followups, invoices, reports |
| SMS | Twilio | Reminders, confirmations, alerts |
| Push | FCM | Real-time notifications |

### 18.2 Channel Architecture

**Outbound Message Structure:**
- Organization and recipient info
- Channel-specific content (subject for email)
- Template reference (optional)
- Metadata for tracking

**Send Result:**
- Success/failure status
- External message ID for tracking
- Error details if failed

**Message Status Tracking:**
- Pending → Sent → Delivered
- Failed/Bounced states for errors

---

## 19. Scalability Architecture

### 19.1 Scaling Dimensions

| Scale | Businesses | Memories | Requests | Agents |
|-------|------------|----------|----------|--------|
| MVP | 100 | 100K | 1K/day | 5 types |
| Growth | 1,000 | 1M | 10K/day | 10 types |
| Scale | 10,000 | 10M | 100K/day | 20 types |
| Enterprise | 100,000+ | 100M+ | 1M+/day | 50+ types |

### 19.2 Database Scaling Strategy

**Convex Built-in Scaling:**
- Compute: Automatic
- Storage: Automatic
- Subscriptions: Automatic

**Limits to Watch:**
- Document size: 1MB
- Query result size: 8MB
- Function timeout: 120 seconds

**Index Strategy:**
- Primary indexes: organizationId, userId, conversationId
- Composite indexes: Common query patterns
- Vector indexes: 3072 dimensions with filter fields

**Data Partitioning (Future):**
- Hot/cold separation: Last 30 days (hot), 30-180 days (warm), 180+ days (cold)
- Niche-based sharding: If needed at 1M+ memories per niche

### 19.3 Vector Search Scaling

**Current (Convex Built-in):**
- Max dimensions: 4096
- Max results: 256
- Suitable for: Up to 10M vectors

**Future Options (If Needed):**

| Option | Type | Cost | Performance | Scaling |
|--------|------|------|-------------|---------|
| Qdrant | Self-hosted or cloud | Medium | Excellent | Horizontal |
| Pinecone | Managed | Higher | Excellent | Automatic |

**Migration Strategy:**
- Gradual migration
- Dual write during transition
- Convex as fallback

### 19.4 Horizontal Scaling

**Stateless Components (Easy to Scale):**
- API routes: Vercel serverless (auto-scale)
- Memory service: Convex functions (auto-scale)
- Embedding service: API calls (rate limited)

**Stateful Components (Managed):**
- Database: Convex managed
- Vector index: Convex managed
- Real-time subscriptions: Convex managed

**Background Job Scaling:**
- Consolidation: Parallel by org
- Extraction: Parallel by conversation
- Decay: Batch processing

**Cache Scaling:**
- L1: Request-scoped (inherent)
- L2: Convex real-time (scales with Convex)
- L3: Consider Redis/Upstash at scale

---

## 20. Technology Evaluation

### 20.1 Comparison Matrix

| Aspect | Convex Native | Convex + mem0 | Convex + LangGraph | Full LangChain/LangGraph |
|--------|---------------|---------------|--------------------| ------------------------|
| **Complexity** | Low | Medium | Medium-High | High |
| **Integration** | Native | API bridge | SDK integration | Full migration |
| **Real-time** | Excellent | Good | Limited | Limited |
| **Memory Features** | Basic→Custom | Advanced | Built-in checkpoints | Built-in |
| **Cost** | Low | Medium | Medium | Higher |
| **Vendor Lock-in** | Convex | Convex + mem0 | Convex + LangChain | LangChain |
| **Scaling** | Good | Good | Good | Excellent |
| **MVP Speed** | Fast | Medium | Medium | Slow |

### 20.2 Recommended Stack by Phase

**MVP (Phase 1):**
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Database | Convex | Already integrated, real-time, scales well |
| Vector Search | Convex built-in | Native, consistent, sufficient for MVP |
| Memory | Custom on Convex | Full control, fastest to implement |
| Agents | Convex scheduled functions | Simple, sufficient for current needs |
| LLM | OpenRouter (default) | Multi-model access, fallback options |
| Embeddings | text-embedding-3-large via OpenRouter/OpenAI | Higher quality, 3072 dims |

**Growth (Phase 2):**
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Database | Convex | Continue with proven foundation |
| Vector Search | Convex (evaluate Qdrant if needed) | Scale with needs |
| Memory | Custom + evaluate mem0 | Advanced features if needed |
| Agents | Custom + evaluate LangGraph | Complex flows if needed |
| LLM | OpenRouter + direct provider APIs | Cost optimization |
| Embeddings | OpenAI or Voyage | Best quality for use case |

**Scale (Phase 3):**
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Database | Convex + potential hot/cold separation | Optimized for scale |
| Vector Search | Qdrant Cloud or Pinecone | If scale demands |
| Memory | Hybrid Convex + mem0 | Best of both |
| Agents | Hybrid custom + LangGraph | Complex orchestration |
| LLM | Multi-provider with intelligent routing | Cost efficiency |
| Embeddings | Dedicated embedding service | Performance |

### 20.3 Decision Frameworks

**When to add LangGraph:**
- ☐ Agents need complex state machines (5+ states)
- ☐ Need human-in-the-loop for multiple steps
- ☐ Require time-travel debugging
- ☐ Building multi-agent collaboration
- ☐ Need streaming with intermediate state updates
- **If 3+ checked → Consider LangGraph**

**When to add mem0:**
- ☐ Need graph-based memory with entity relationships
- ☐ Want pre-built memory extraction pipelines
- ☐ Scaling beyond 10M memories
- ☐ Need cross-platform memory sync
- ☐ Want managed memory service
- **If 3+ checked → Consider mem0**

**When to add external vector DB:**
- ☐ Vector count exceeds 10M
- ☐ p95 latency exceeds 50ms
- ☐ Need advanced filtering not supported by Convex
- ☐ Need hybrid search (vector + full-text + filters)
- ☐ Cost of Convex vector search becomes prohibitive
- **If 2+ checked → Evaluate Qdrant or Pinecone**

### 20.4 Alternative Approaches: Custom vs Managed Memory

#### Alternative A: Custom Memory on Convex (Recommended for MVP)

**Strengths:**
- Full control over implementation
- Native integration with existing stack
- Real-time capabilities built-in
- No additional dependencies
- Cost efficient (no extra services)
- Fastest path to market

**Weaknesses:**
- More implementation effort
- Need to build state machine ourselves
- No pre-built patterns
- Limited to Convex's vector search capabilities

#### Alternative B: mem0 Integration

**Strengths:**
- Advanced graph-based memory with entity relationships
- Pre-built memory extraction pipelines
- Battle-tested memory management
- Managed service with scaling

**Weaknesses:**
- Additional dependency and API bridge needed
- Needs integration with Convex (sync complexity)
- Learning curve
- Additional cost

**Recommendation:** Start with Custom Convex for MVP, evaluate mem0 when memory complexity increases or scale demands advanced features.

#### Alternative C: LangGraph for Agents

**Strengths:**
- Built-in state management
- Checkpointing and persistence
- Human-in-the-loop patterns
- Pre-built agent patterns
- Active community

**Weaknesses:**
- Additional dependency
- Needs integration with Convex
- Learning curve
- May be overkill for simple agents

**Recommendation:** Start with Custom Convex agents for MVP, evaluate LangGraph when agent complexity increases.

---

## 21. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-3)

**Goal:** Working memory system with basic retrieval

**Week 1: Schema & Infrastructure**
- Extend Convex schema with all memory tables
- Create embedding service with OpenAI integration
- Wire up message persistence in chat API
- Create basic memory CRUD operations

**Week 2: Retrieval & Context**
- Implement vector search across memory layers
- Build context assembly service
- Integrate memory context into chat system prompt
- Add token budget management

**Week 3: Testing & Refinement**
- End-to-end testing of memory flow
- Performance optimization
- Basic monitoring and logging
- Documentation

### Phase 2: Intelligence (Weeks 4-6)

**Goal:** Automatic learning and memory extraction

**Week 4: Memory Extraction (COMPLETE)**
- ~~Build LLM-based memory extraction pipeline~~ **DONE** (`src/convex/memoryExtraction.ts`)
- ~~Implement deduplication logic~~ **DONE** (vector similarity ≥ 0.92, version chain)
- ~~Create cron job for extraction~~ **DONE** (`src/convex/crons.ts`, 2-min interval)
- ~~Add event emission in chat route~~ **DONE** (conversation_end, tool_success, tool_failure)
- Add explicit memory tools (remember, forget) — **moved to Phase 6**

**Week 5: Decay & Lifecycle (COMPLETE)**
- ~~Implement decay algorithm~~ **DONE** (`src/lib/ai/memory/decay.ts` — Ebbinghaus formula with 7 type-specific rates)
- ~~Create scheduled decay update job~~ **DONE** (`src/convex/memoryDecay.ts` — hourly cron + on-access boost)
- ~~Build memory archival and cleanup~~ **DONE** (`src/convex/memoryArchival.ts` — daily archival, LLM compression via action-retrier, weekly purge)
- ~~Add TTL management~~ **DONE** (`src/lib/ai/memory/ttl.ts` — per-type defaults, auto-set on create, filtered in retrieval)

**Week 6: Memory Tools & Chat Integration (NEXT)**
- Add explicit memory tools (rememberFact, forgetMemory, searchMemories, updatePreference)
- Build conversation summary with sliding window
- Complete end-to-end memory loop in chat route
- Add feedback signal collection

### Phase 3: Agents (Weeks 7-9)

**Goal:** Background agents with approval workflow

**Week 7: Agent Framework**
- Build agent execution framework
- Create scheduled job infrastructure
- Implement first agent (Followup Agent)
- Add agent memory integration

**Week 8: Guardrails & Approval**
- Implement risk assessment system
- Build approval queue and workflow
- Create notification system
- Add audit logging

**Week 9: Additional Agents**
- Implement Reminder Agent
- Implement Invoice Agent
- Add Sales Funnel Agent
- Integration testing

### Phase 4: Optimization (Weeks 10-12)

**Goal:** Production-ready with cost efficiency

**Week 10: Cost Optimization**
- Implement context caching
- Add model routing logic
- Build cost tracking
- Create budget management

**Week 11: Security & Compliance**
- Implement injection prevention
- Add PII handling
- Build data export for compliance
- Security audit

**Week 12: Polish & Launch**
- Performance optimization
- Monitoring and alerting
- Documentation
- Launch preparation

---

## 22. Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DEPLOYMENT ARCHITECTURE                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    VERCEL                                                        │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Edge Network (Global)                                         │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                         │  │
│  │  │  Static Assets   │  │  Edge Functions  │  │   ISR Pages      │                         │  │
│  │  │  (CDN cached)    │  │  (Auth, routing) │  │  (Dashboard)     │                         │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘                         │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Serverless Functions                                          │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                         │  │
│  │  │   /api/chat      │  │   /api/agent     │  │   /api/webhook   │                         │  │
│  │  │  (60s timeout)   │  │  (Actions)       │  │  (External)      │                         │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘                         │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CONVEX CLOUD                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Functions                                                  │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                         │  │
│  │  │     Queries      │  │    Mutations     │  │     Actions      │                         │  │
│  │  │  (Read data)     │  │  (Write data)    │  │  (External APIs) │                         │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘                         │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Scheduled                                                  │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                                               │  │
│  │  │   Cron Jobs      │  │  Scheduled Fns   │                                               │  │
│  │  │  (Workers)       │  │  (Delayed exec)  │                                               │  │
│  │  └──────────────────┘  └──────────────────┘                                               │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Database                                                   │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                         │  │
│  │  │   Document DB    │  │  Vector Index    │  │   File Storage   │                         │  │
│  │  │  (All tables)    │  │  (Embeddings)    │  │  (Attachments)   │                         │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘                         │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Environment Configuration

**Core Services:**
- Convex (CONVEX_DEPLOYMENT, NEXT_PUBLIC_CONVEX_URL)
- Authentication (BETTER_AUTH_SECRET, BETTER_AUTH_URL)

**AI Providers:**
- OpenRouter, OpenAI, Google AI API keys

**Observability:**
- Langfuse (public key, secret key, host)

**Communication:**
- Resend (email), Twilio (SMS)

**Feature Flags:**
- FEATURE_MEMORY_ENABLED
- FEATURE_AGENTS_ENABLED
- FEATURE_TRACING_ENABLED

---

## Appendix A: Key Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary Database | Convex | Already integrated, real-time, scales well |
| Vector Search | Convex built-in | Native, consistent, sufficient for MVP |
| Embeddings | text-embedding-3-large via OpenRouter/OpenAI | Higher quality, 3072 dims |
| Memory Framework | Custom on Convex | Full control, fastest to implement |
| Memory Extraction | gpt-4o-mini via cron worker | Cost-efficient async extraction |
| Agent Framework | Custom with Convex crons | Simple, sufficient for current needs |
| LLM Provider | OpenRouter (default) | Multi-model access, fallback options |
| Future Vector DB | Qdrant (if needed) | Open source, good performance, cost effective |
| Future Memory | mem0 (evaluate) | Advanced features if custom insufficient |
| Future Agents | LangGraph (evaluate) | Complex orchestration if needed |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Memory Layer** | Hierarchical level in the memory system (Platform/Niche/Business/Agent) |
| **Decay Score** | Numeric value (0-1) representing memory strength over time |
| **Memory Extraction** | Process of identifying and storing memories from conversations |
| **Memory Consolidation** | Process of merging, summarizing, and cleaning memories |
| **Tenant Isolation** | Security boundary ensuring data separation between organizations |
| **Context Window** | Maximum tokens available for LLM input |
| **Token Budget** | Allocated tokens for specific context sections |
| **Risk Level** | Classification of action severity for guardrail purposes |
| **Approval Queue** | Pending actions requiring human approval |
| **Trace Span** | A single operation within a distributed trace |
| **Worker** | Background job that runs on a schedule |
| **Agent** | Autonomous AI component that performs specific tasks |

---

*Document Version: 1.1*
*Last Updated: February 25, 2026*
*Author: RecommendMe AI Team*
*Source: Combined from MEMORY_SYSTEM_CANVAS.md and SYSTEM_ARCHITECTURE.md*
*Status: Phases 0–6.8 Complete — Full Memory System Operational*
