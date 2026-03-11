# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (Phase 12.9 ContextInspector Live Wiring — Phase 12 COMPLETE)

- `InspectorMemory` and `InspectorData` interfaces exported from `src/lib/ai/memory/retrieval.ts`
- Optional `inspectorData` field on `RetrievalResult`; built inside `retrieveMemoryContext` using already-computed `scored` arrays and `formatted.memoryIds`; env-gated by `NEXT_PUBLIC_SHOW_CONTEXT_INSPECTOR === 'true'`; capped at 50 memories sorted by composite score
- `messageMetadata` callback on `result.toUIMessageStreamResponse()` in `src/app/api/chat/route.ts`; emits `{ retrievalTrace: inspectorData }` on `finish` part — zero extra HTTP calls, zero schema changes
- `isInspectorData()` runtime type guard in `ChatContainer.tsx` for safe metadata narrowing
- `lastAssistantTrace` memo in `ChatContainer` that scans `messages` in reverse to find the most recent assistant `metadata.retrievalTrace`
- `<ContextInspector>` conditionally mounted in `ChatContainer` with live `memories`, `tokenBudget`, and `tokensUsed` from the retrieval trace
- New validation script: `scripts/test-phase12-context-inspector.sh` (17 static + TypeScript checks)

### Changed (Phase 12.9)

- `RetrievedMemory.id` in `src/components/memory/ContextInspector.tsx` widened from `Id<'businessMemories'>` to `string` (id is used only as a React key; Convex import removed)
- `ContextInspector` now receives real retrieval data instead of empty/stub props

### Added (Phase 12.8 Sidebar CRM Wiring & Memory Stats)

- Sidebar CRM tabs (Leads/Schedule/Invoices) now display live Convex data via `useQuery` in `DashboardShell`
- New `businessMemories.getStats` public query for server-side memory stats aggregation (type counts, decay bands, active/archived totals)
- New validation script: `scripts/test-phase12-crm-wiring.sh` (15 static checks)

### Changed (Phase 12.8)

- `MemoryAnalytics` now uses `api.businessMemories.getStats` instead of client-side aggregation over a capped 100-item list
- `DashboardShellProps` no longer accepts `leads`/`appointments`/`invoices` as props — data is fetched internally via Convex subscriptions

### Added (Phase 12.7 Dashboard Navigation & Realtime Polish)

- Header-level dashboard navigation links in `src/components/dashboard/DashboardHeader.tsx`:
  - Chat link (`MessageSquare`) to `ROUTES.CHAT`
  - Memory link (`Brain`) to `ROUTES.MEMORY`
  - Active route highlighting via `usePathname()`
- New centralized route constant in `src/lib/constants.ts`: `ROUTES.MEMORY = '/memory'`
- New validation script: `scripts/test-dashboard-nav-polish.sh` covering route wiring, realtime approval wiring, budget-tier wiring, and compatibility guardrails

### Changed

- `src/app/(dashboard)/components/DashboardShell.tsx` now uses pure Convex realtime subscription (`api.approvalQueue.listPending`) for approval notifications instead of 60-second REST polling
- `src/app/(dashboard)/memory/components/MemoryDashboardContainer.tsx` now fetches organization settings via `api.organizations.getOrganization` and passes real `budgetTier` to `CostAnalytics` (fallback: `'starter'`)

### Compatibility

- Preserved `src/app/api/approvals/route.ts` for external callers/tests while dashboard notifications migrate to Convex realtime

### Added (Phase 11 Runtime Wiring — Learning Pipeline)

#### Dedicated Learning Pipeline (`src/convex/learningPipeline.ts`)
- New `runPatternDetectionBatch` internalAction: cron-triggered cross-organisation pattern detection over 30-day message windows, persisting to new `detectedPatterns` table with upsert semantics
- New `runFailureLearningBatch` internalAction: cron-triggered batch processing of `tool_failure` events, classifying failures and creating enriched agent memory entries with prevention rules
- New `scheduleLearningAfterExtraction` internalMutation: bridges extraction pipeline to learning pipeline via `ctx.scheduler.runAfter(0, ...)` for fresh-data processing
- Supporting queries: `getExistingPatterns`, `getRecentMessages`, `getRecentToolFailureEvents`, `getExistingFailureMemories`, `getPreviousQualitySnapshot`
- Supporting mutations: `upsertDetectedPattern`, `insertQualitySnapshot`

#### Schema Additions
- `detectedPatterns` table with `patternType` enum (5 values), confidence/occurrence tracking, evidence array, and `by_org_type` + `by_org_active` indexes
- `qualitySnapshots` table with `overallScore`, structured metrics/alerts arrays, and `by_org_created` index for time-series trending

#### Cron Entries
- `pattern detection pipeline` — every 6 hours
- `failure learning pipeline` — every 2 hours
- Existing `memory quality monitor` (daily 07:00 UTC) enhanced with snapshot persistence

#### Agent System Prompt Injection
- `buildFailurePreventionPrompt()` in `agentRunner.ts`: extracts failure memories for the current agent type, formats prevention context, and appends "Known Issues to Avoid" section to all 4 agent system prompts (reminder, invoice, sales, followup)

#### Quality Monitor Enhancement
- `qualityMonitor.ts` now loads previous `qualitySnapshots` for delta comparison (was previously baseline-only)
- Snapshots persisted to `qualitySnapshots` table for Phase 12 dashboard trending
- `checkForAlerts` imported and used to populate structured alert arrays in snapshots

#### Extraction Pipeline Hook
- `processExtractionBatch` in `memoryExtraction.ts` now schedules learning pipeline actions after successful batch completion

#### Validation
- New `scripts/test-phase11-runtime.sh` — 58 static checks covering schema tables, cron entries, pipeline actions, extraction hooks, and agent prompt injection

### Fixed (Review Pass 2 — production readiness)

- **BLOCKER** `memoryExtraction.ts` (cross-conversation pattern accumulation): Fixed 3 broken regex literals in the stored-pattern parser — `[Pattern:(w+)]` → `/\[Pattern:(\w+)\]/`, `(d+)` → `/(\d+)/`, `([d.]+)` → `/([\d.]+)/`. Without this fix, every previously-stored pattern was reconstructed with `type: 'time_preference'`, `occurrences: 1`, `confidence: 0`, causing `shouldAutoLearn()` to always return false for accumulated patterns (Phase 11.2 cross-conversation learning was silently non-functional).
- **HIGH** `agentDefinitions.list`: Changed unbounded `.collect()` to `.take(100)` on the user-facing `list` query to prevent full-table scans as agent definition count grows.
- **HIGH** `memoryExtraction.adjustFeedbackScores`: Fixed semantic incorrectness where a thumbs-down/up would adjust all memories accessed in the last 30 minutes. Now accepts an optional `memoryIds` array for targeted adjustment; fallback time-window reduced from 30 min → 5 min and batch cap reduced from 20 → 10 to minimise blast radius. Added `TODO(phase-12)` to wire explicit memory IDs from the retrieval trace.
- **HIGH** `memoryArchival`: Restored four missing `isCronDisabled()` early-exit guards in `archiveDecayedMemories`, `compressArchivedMemories`, `purgeExpiredMemories`, and `lifecycleHealthCheck` — these were present in commit `7de242b` and were inadvertently dropped in a subsequent rebase. Without the guards, all four cron jobs run in local dev environments, consuming LLM credits and producing noise.
- **MEDIUM** `memoryExtraction`: Added cross-reference comment above `FEEDBACK_CONFIDENCE_DELTA` and `FEEDBACK_DECAY_DELTA` constants pointing to the canonical values in `src/lib/learning/feedback.ts` — the two files must be kept in sync because Convex functions cannot import from `src/lib` at runtime.

### Fixed (Hardening Pass — feat/feedback-collection-11a)

- **HIGH** `ChatContainer.handleFeedback`: Added in-flight submission guard using ref-tracked message locks to prevent duplicate concurrent feedback requests for the same assistant message.
- **HIGH** `approvalQueue.emitApprovalLearningEvent` + `memoryExtraction.processFeedbackOrApprovalEvent`: Approval learning events now include `agentType` and `approverUserId`, and extraction routes resulting agent memories to the correct `agentType` instead of hardcoding `chat`.
- **MEDIUM** `api/feedback/route`: Added defensive conversation consistency validation (`message.conversationId` must match request `conversationId`) before mutation.
- **LOW** `scripts/test-feedback-collection.sh`: Fixed optional live-probe env hint to reference `ORG_ID` (the variable actually consumed by the script).
- **BLOCKER** `agentRunner.recordAgentLearning`: PII redaction was not applied before inserting into `agentMemories`. Now calls `applyMemoryLayerPiiPolicy(content, 'agent')` (redact policy) prior to write. Deduplication also added: patches existing same-category entry (updates content, takes max confidence, increments useCount) instead of inserting a duplicate.
- **HIGH** `agentRunner.executeApprovedQueueItem`: Function was a logging stub — no side effects were executed. Replaced with full implementation: idempotency guard, claim-ownership check, action dispatch (`update_lead_status` / `update_lead_notes` / `log_recommendation`), retry scheduling on transient failures, finalize bookkeeping (`recordApprovalExecutionResult` + `markApprovedProcessed`), and post-execution reconciliation call. Nine previously-failing tests now pass.
- **HIGH** `agentRunner.reconcileExecutionAfterApprovalDecision`: Function was a logging stub. Replaced with full implementation: fetches all approvals for the execution, checks whether all items are resolved, then either completes or fails the execution based on `approvalExecutionResults`.
- **HIGH** `auditLogs.list`: Any org member could query `high`/`critical` risk-level audit entries. Added role guard — requests with `riskLevel: 'high'` or `riskLevel: 'critical'` now throw `Insufficient permissions` for `member`-role users; only `owner` and `admin` roles may view these entries.
- **MEDIUM** `feedback.ts normalizeFeedbackArgs`: User-supplied `comment` field was stored without PII redaction. Now applies `redactPiiContent()` before the memoryEvent insert.
- **LOW** `memoryValidation.ts`: Added cross-reference comment pointing to `src/lib/security/pii.ts` — both files must be updated together when PII patterns change.
- Added supporting internal queries: `agentExecutions.getById`, `approvalQueue.getById`, `approvalQueue.getByExecution`.
- Added `agentRunner.recordApprovalExecutionResult` internalMutation to track per-approval execution outcomes.

### Added

#### Feedback Signal Collection (Phase 11.1)
- Thumbs up/down feedback buttons on assistant messages in `src/components/chat/MessageBubble.tsx` — hidden by default, revealed on hover, amber/red selection state, disabled after rating
- Feedback API endpoint at `src/app/api/feedback/route.ts` with session auth, dev mode bypass, and distributed `feedback_submit` rate limiting
- Feedback endpoint now validates message ownership + assistant-only target before accepting a signal
- Feedback state management in `ChatContainer` with optimistic update and rollback on API failure
- Learning module at `src/lib/learning/feedback.ts` with:
  - 8 signal weights (4 explicit: thumbs_up/down, correction, instruction; 4 implicit: follow_up_question, rephrase, task_complete, tool_retry)
  - `detectImplicitSignals()` — analyzes conversation flow to detect satisfaction, confusion, or retry patterns
  - `computeScoreAdjustment()` — clamped confidence/decay delta calculation
- Convex feedback module at `src/convex/feedback.ts` with deduplicated `recordFeedback` + `recordFeedbackFromApi` event creation
- Enhanced `processFeedbackOrApprovalEvent` in `src/convex/memoryExtraction.ts` to trigger `adjustFeedbackScores` after storing agent memory (single adjustment path per event)
- Implicit signal detection in chat route — `detectImplicitSignals` merged into `memorySignalsToEmit` via `after()` pipeline
- Feedback types: `FeedbackRating`, `ExplicitSignalType`, `ImplicitSignalType`, `FeedbackSignalWeight`, `ScoreAdjustment` in `src/types/index.ts`
- Validation script `scripts/test-feedback-collection.sh` with static gates + targeted tests + optional live probe
- Automated API edge-case tests for feedback ingress in `src/app/api/feedback/route.test.ts` (401/429/404/403/400/success paths)
- Cursor pagination regression tests for chat history in `src/convex/messages.test.ts`
- Package scripts for reproducible validation:
  - `test:feedback-collection`
  - `test:phase11`

#### Approval Learning Integration (Phase 11.5 slice)
- `src/convex/approvalQueue.ts` now emits idempotent `approval_granted` / `approval_rejected` learning events from the review decision path
- Approval learning emission is non-blocking and does not interrupt approval review completion when event insertion fails
- Score adjustment remains centralized in extraction event handling to avoid duplicate confidence/decay updates

#### Pattern Detection Runtime Wiring (Phase 11.2)
- `src/convex/memoryExtraction.ts` (`processConversationEnd`): `detectPatterns`, `shouldAutoLearn`, and `patternToMemoryContent` imported and called after each conversation ends — auto-learning fires when confidence ≥ 0.85 and occurrence count ≥ 10
- Utility module: `src/lib/learning/patternDetection.ts` — 5 pattern types (time_preference, communication_style, decision_speed, price_sensitivity, channel_preference), configurable confidence scoring, evidence collection

#### Failure Learning Runtime Wiring (Phase 11.3)
- `src/convex/agentRunner.ts` (`runAgentForOrg`): `checkForRelevantFailures` runs pre-action to inject prevention context into the system prompt; `createFailureRecord` + `failureToMemoryContent` called on agent failure to persist the failure as an agent memory
- `formatPreventionContext` formats past failures into human-readable prevention hints for agent system prompts
- Utility module: `src/lib/learning/failureLearning.ts` — 4 failure categories, automatic prevention-rule derivation, keyword-similarity pre-check (threshold 0.5), batch deduplication (0.8 threshold)

#### Memory Quality Monitor (Phase 11.4)
- Created `src/convex/qualityMonitor.ts` with `getMemoryStatsForOrg` (internalQuery), `listActiveOrganizationIds` (internalQuery), and `runQualityMonitorCheck` (internalAction) — computes quality snapshot per org and writes alerts to `auditLogs`
- Daily cron registered in `src/convex/crons.ts` as `'memory quality monitor'` running at 07:00 UTC via `runQualityMonitorCheck`
- Utility module: `src/lib/learning/qualityMonitor.ts` — 5 weighted quality metrics (relevance 0.3, accuracy 0.25, freshness 0.2, retrieval_precision 0.15, recall 0.1); alerts on >10% quality drop within 24 h
- Companion types in `src/types/index.ts`: `QualityMetricName`, `QualityMetric`, `QualitySnapshot`, `QualityAlert`, `PatternType`, `DetectedPattern`, `PatternDetectionConfig`, `PatternDetectionResult`, `FailureCategory`, `FailureRecord`, `FailureLearningResult`, `FailureCheckResult`
- Added `scripts/test-phase11-complete.sh` for static verification of all 11.2–11.4 modules
- Added unit test coverage for Phase 11.2–11.4 learning utility modules:
  - `src/lib/learning/patternDetection.test.ts` — 35 tests covering `classifyEvent`, `detectPatterns`, `shouldAutoLearn`, `patternToMemoryContent`, and round-trip regex compatibility with `memoryExtraction.ts`
  - `src/lib/learning/failureLearning.test.ts` — 28 tests covering `classifyFailure`, `createFailureRecord`, `checkForRelevantFailures`, `processFailureBatch`, `failureToMemoryContent`, `formatPreventionContext`
  - `src/lib/learning/qualityMonitor.test.ts` — 21 tests covering all 5 score computations, `computeOverallScore`, `checkForAlerts`, `computeQualityMetrics`, `createQualitySnapshot`, `formatQualityReport`

#### Security Hardening (Phase 9b)
- Added server-side security rate limiting in `src/lib/security/rateLimiting.ts` with distributed Convex-backed enforcement in `src/convex/security.ts` and route-level enforcement in `src/app/api/chat/route.ts` and `src/app/api/approvals/route.ts` (returns HTTP `429` + `Retry-After`)
- Added tenant-isolation error classification helper `src/lib/security/tenantIsolation.ts` and structured security-event logging through new Convex mutation `auditLogs.recordSecurityEvent`
- Added layer-aware PII policy helpers:
  - `src/lib/security/pii.ts` for shared detection/redaction policy
  - `src/convex/memoryValidation.ts` for Convex-runtime enforcement (`platform` block, `niche/agent` redact, `business` allow)
- Applied PII policy across memory write paths:
  - `src/convex/platformMemories.ts`
  - `src/convex/nicheMemories.ts`
  - `src/convex/agentMemories.ts`
  - `src/convex/businessMemories.ts`
- Added security-focused tests and validation artifacts:
  - `src/lib/security/rateLimiting.test.ts`
  - `src/lib/security/pii.test.ts`
  - `src/lib/security/tenantIsolation.test.ts`
  - `src/convex/memoryValidation.test.ts`
  - `src/convex/memoryExtraction.test.ts`
  - `src/convex/agentRunner.security.test.ts`
  - `src/convex/security.test.ts`
  - updates to `src/convex/auditLogs.test.ts`
  - `scripts/test-security-hardening.sh`
- Hardened agent-memory PII enforcement on `memoryExtraction.insertAgentMemory` so redaction is consistently applied before persistence and embedding. (`agentRunner.recordAgentLearning` PII enforcement was completed in the hardening pass above.)
- Made security-event audit writes non-blocking on rejection/error paths in chat and approval APIs to reduce tail latency impact under incident load
- Tenant-isolation error classification now supports structured error codes in addition to message matching

#### Observability, Tracing & Cost Management (Phase 10a)
- Trace context infrastructure (`src/lib/tracing/`) with `TraceContext` class, `withSpan`/`withSpanSync` helpers, and typed span attributes for LLM, retrieval, and tool spans
- Convex `traces` table with indexes (`by_trace`, `by_org_created`, `by_span_type_created`, `by_created`) and CRUD mutations (`record`, `recordBatch`, `recordSpans`, `listByTrace`, `listByOrg`, `purgeOldTraces`)
- Convex `llmUsage` table with indexes (`by_org_created`, `by_org_purpose_created`, `by_org_model_created`, `by_created`) and functions (`record`, `recordBatch`, `getOrgUsage`, `getOrgBudgetStatus`, `purgeOldUsage`)
- Model pricing engine (`src/lib/cost/pricing.ts`) with static pricing table for gpt-4o-mini, gpt-4o, text-embedding-3-large/small, gemini-2.0-flash, gemini-1.5-pro; `estimateCost()` and `estimateEmbeddingCost()` functions
- Budget tier system (`src/lib/cost/budgets.ts`) with Free/Starter/Pro/Enterprise tiers, daily+monthly token limits, and `checkBudget()` function returning ok/warning/exceeded status
- `callLLMWithUsage()` in `src/convex/llmProvider.ts` -- new instrumented variant of `callLLM` that extracts `prompt_tokens`, `completion_tokens`, `total_tokens` from OpenAI-compatible API responses; backward-compatible `callLLM` wrapper preserved
- Chat route (`src/app/api/chat/route.ts`) instrumented with `TraceContext` root span and `withSpan` around memory retrieval; completed trace spans are persisted to Convex asynchronously via `after()`
- Agent runner (`src/convex/agentRunner.ts`) instrumented: all 4 agent types (followup, reminder, invoice, sales) now use `callLLMWithUsage` and record per-execution LLM usage to `llmUsage` table
- Memory extraction pipeline (`src/convex/memoryExtraction.ts`) updated to return per-call token usage from `callExtractionLLM`; `reExtractConversation` action records usage to `llmUsage` table
- Embedding service (`src/convex/embedding.ts`) updated: `generateAndStore` records per-embedding token usage to `llmUsage` table with model-aware cost estimation
- Shared validators (`src/convex/lib/validators.ts`) extended with `spanTypeValues`, `spanStatusValues`, `llmPurposeValues` and corresponding TypeScript types
- Cleanup crons added: weekly `traces.purgeOldTraces` (30-day retention, Sundays 06:00 UTC), monthly `llmUsage.purgeOldUsage` (90-day retention, 1st of month 06:30 UTC)
- Validation script `scripts/test-observability.sh` with expanded automated checks covering file existence, schema tables/indexes, module exports, instrumentation wiring, and cron registration
- AI SDK native `onFinish` usage tracking on `streamText` in chat route -- captures real token counts from the SDK, recorded non-blocking via `after()`
- OpenRouter `total_cost` extraction in `callLLMWithUsage` -- reads exact cost from API responses when available, falls back to estimation
- Unified pricing source (`src/lib/cost/pricing.ts`) now powers both Next.js chat usage tracking and Convex server cost estimation (agentRunner, embedding, memoryExtraction)
- Public mutations `recordSpans` and `recordUsage` secured with `assertMemoryApiToken` auth check
- Agent runner usage recording converted from blocking `await` to fire-and-forget `ctx.scheduler.runAfter(0, ...)`
- Trace query hardening: `traces.listByTrace` now requires authenticated org context and reads through an org-scoped index (`by_org_trace_created`) to prevent cross-tenant trace lookup by raw `traceId`
- Extraction usage coverage hardening: main `conversation_end` extraction path now records `llmUsage` (not only manual re-extraction), and tool-outcome summarization records `llmUsage` as `purpose: 'summary'`
- Budget query hardening: `llmUsage.getOrgBudgetStatus` now takes caller-provided `nowMs` (no `Date.now()` in query), uses month-bounded index scans, and returns a `truncated` flag for visibility when scan limits are hit
- Retention reliability hardening: `traces.purgeOldTraces` and `llmUsage.purgeOldUsage` now self-schedule follow-up batches when backlog exceeds a single run

#### Observability, Tracing & Cost Management (Phase 10b)
- Added `src/lib/cost/manager.ts` for budget-aware model routing (`ok`/`warning`/`exceeded`) with tier downgrade logic and reduced-context behavior
- Added organization-level `budgetTier` settings (`free|starter|pro|enterprise`) in `src/convex/schema.ts` and `src/convex/organizations.ts` with default `starter`
- Chat route now enforces real-time budget guardrails:
  - warning threshold (`>=80%`) downgrades model tier and reduces context load
  - exceeded threshold (`>=100%`) returns graceful HTTP `429` with `Retry-After`
- Added optional Langfuse ingestion sync (`src/lib/tracing/langfuse.ts`) and wired chat trace persistence to send trace/span/generation data when enabled by env vars
- Context formatting updated for cache-friendly ordering: platform/niche memory sections are emitted before business/agent sections
- System prompt v2 now places static instructions before dynamic memory blocks to improve prompt prefix cache potential
- Added focused tests:
  - `src/lib/cost/manager.test.ts`
  - `src/lib/ai/memory/contextFormatter.test.ts`
  - `src/lib/tracing/langfuse.test.ts`
- Expanded `scripts/test-observability.sh` with Phase 10b checks and new test gates
- Budget enforcement fail-closed hardening: truncated budget scans now return graceful HTTP `429` (no warning-mode pass-through when usage visibility is incomplete)
- Budget check load hardening: short-lived org-level budget snapshot caching added on the API runtime path to reduce repeated hot-path scans
- Trace ordering hardening: `traces.listByTrace` now reads via `by_org_trace_start` for deterministic span chronology
- Provider analytics normalization: Convex-side usage tracking now records provider IDs as canonical lowercase values (`openrouter` / `openai`)
- Manual re-extraction usage now preserves provider exact-cost metadata when available (fallback remains estimation)

#### Approval Workflow Core (Phase 9a)
- Approval queue persistence with `approvalQueue` table + APIs in `src/convex/approvalQueue.ts`
- Append-only audit logging with `auditLogs` table + APIs in `src/convex/auditLogs.ts`
- Agent runner integration for approval-gated actions:
  - high-risk actions enqueue through `internal.approvalQueue.enqueueBatch`
  - queued IDs are returned in execution results as `approvalQueueItemIds`
  - approval lifecycle reconciliation via `executeApprovedQueueItem` and `reconcileExecutionAfterApprovalDecision`
  - pre-execution and lifecycle events are recorded through `internal.auditLogs.appendBatch`
- Approval tools added for chat usage: `listPendingApprovals`, `approveAction`, `rejectAction`
- Approval notification API route at `src/app/api/approvals/route.ts` and dashboard polling integration
- Input validation layer for chat ingress in `src/lib/security/inputValidation.ts` wired into chat route
- Approval expiration cron (`expireStalePending`) scheduled every 30 minutes in `src/convex/crons.ts`
- Tenant bootstrap hardening: signup now creates dedicated organizations via `createOrganizationForSignup`
- Test coverage added for approval queue, approval tools, audit logs, input validation, and approval lifecycle wiring

#### Sales Funnel Agent (Phase 7d)
- Sales funnel agent at `src/lib/ai/agents/sales/` — scores leads, detects stale pipelines, recommends stage transitions, and surfaces pipeline insights
- Convex-side agent logic at `src/convex/agentLogic/sales.ts` with settings, config, system prompt, prompt builder, and plan validator
- Four sales actions: `score_lead`, `recommend_stage_change`, `flag_stale_lead`, `log_pipeline_insight`
- Event-driven trigger: lead status changes in both `leads.update` and `leads.updateByName` schedule sales agent runs via `ctx.scheduler.runAfter()`
- Daily sales funnel cron job at 11:00 UTC in `src/convex/crons.ts` (runs per-org with bounded `maxLeadsPerBatch` settings)
- Chat tools: `getLeadScore`, `getPipelineOverview`, `getLeadRecommendation` in `src/lib/ai/tools/salesFunnel.ts`
- Internal queries: `agentRunner.getLeadsForSalesPipeline`, `agentRunner.getAppointmentsForLeads`, `agentRunner.getInvoicesForLeads`
- Sanitized sales settings: `sanitizeSalesSettings` for stale threshold, batch size, and high-value threshold
- Extended `runAgentForOrg` with `'sales'` agent type — aggregates appointment/invoice data per lead for pipeline context
- System prompt v2 updated with dedicated Sales Pipeline section and tool documentation
- Agent registry updated — `sales` mapped to `SalesHandler` (no longer throws)
- E2E validation script `scripts/test-sales-agent.sh` with unit test gates and optional live integration section
- Sales action contract hardening: normalized stage/stale param handling between prompt schema and runner execution
- Sales context query hardening: appointments and invoices are now fetched via lead-scoped indexes to avoid lossy org-wide sampling
- Sales note integrity hardening: sales-scoring and recommendation notes no longer mutate `lastContact` (prevents stale/recency metric drift)
- Sales chat analytics hardening: lead scoring now uses lead-id scoped appointment/invoice queries; pipeline overview computes stage buckets with explicit sampling flags when status buckets hit scan caps
- Unit tests: 22 tests in `src/convex/agentLogic/sales.test.ts` (prompt builder, plan validator, settings sanitizer), 17 tests in `src/lib/ai/tools/salesFunnel.test.ts` (engagement scoring, chat tool wiring, error handling)

### Fixed
- Chat history pagination now correctly applies `cursor` filtering in `src/convex/messages.ts`, preventing duplicate pages when loading older messages.
- Approval queue execution now performs real side effects for approved actions in `executeApprovedQueueItem` (was metadata-only), then records execution outcome in `agentExecutions.results.approvalExecutionResults`
- Approval-gated actions now preserve original `actionParams` and assessed `riskLevel` when enqueued (no longer dropped/hardcoded)
- Approval processing lifecycle now uses explicit execution fields (`executionClaimedAt`, `executionProcessedAt`) instead of overloading `rejectionReason`
- `expireStalePending` now writes `approval_review_expired` audit log entries when pending approvals auto-expire
- Approval review API (`POST /api/approvals`) now returns `400` for invalid JSON/payload validation failures instead of collapsing all failures to `500`
- Approved action execution finalization is now fail-safe against duplicate side effects — successful actions are marked processed before non-critical result persistence so retry paths cannot re-run side effects
- Approval queue public APIs no longer allow `authToken` bypass in production; authenticated user context is now mandatory
- Queue audit entries now store the actual `approvalQueue` item ID (instead of the parent execution ID) for accurate traceability
- Chat/reminder organization settings lookups now use authenticated query paths in production, preventing silent auth failures after org API hardening
- Fixed idempotency marker mismatch in `agentRunner.updateLeadNotes` — sales dedup check now matches `[Sales ${timestamp}]` format (was incorrectly checking `[Sales Score ${timestamp}]`, causing duplicate daily scoring)
- Replaced hardcoded stale threshold (`> 7`) in `prompt.ts` and `salesFunnel.ts` with shared `DEFAULT_SALES_SETTINGS.staleThresholdDays` for consistency between cron and chat paths
- Added persistence to `executeRecommendStageChange` in Next.js-side sales handler — now writes `[Stage Recommendation]` notes to leads via `leads.updateByName` (was console-only)

#### Invoice Agent (Phase 7c)
- Invoice agent at `src/lib/ai/agents/invoice/` — creates draft invoices for completed appointments, flags overdue invoices, learns from outcomes
- Convex-side agent logic at `src/convex/agentLogic/invoice.ts` with settings, config, system prompt, prompt builder, and plan validator
- Four invoice actions: `create_invoice`, `update_invoice_status`, `flag_overdue_invoice`, `log_invoice_recommendation`
- Event-driven trigger: appointment `update` to `completed` status schedules invoice agent run via `ctx.scheduler.runAfter()`
- Daily invoice agent cron job at 10:00 UTC for overdue detection in `src/convex/crons.ts`
- Chat tools: `createInvoice`, `listInvoices`, `getInvoiceStats`, `markInvoicePaid` in `src/lib/ai/tools/invoice.ts`
- New Convex mutation `invoices.markAsPaidByLeadName` — fuzzy-matches lead name and marks most recent unpaid invoice as paid
- Internal queries: `invoices.getCompletedAppointmentsWithoutInvoice`, `invoices.getOverdueInvoices`
- Internal mutations: `invoices.createDraftForLeadInternal`, `invoices.updateStatusInternal`, `invoices.flagOverdueInvoiceInternal`
- Extended `AgentContext` with optional `invoices: InvoiceSummary[]` field for overdue invoice data
- System prompt v2 updated with dedicated Invoicing section and tool documentation
- Agent registry updated — `invoice` mapped to `InvoiceHandler` (no longer throws)
- Added invoice-focused tests in `src/lib/ai/tools/invoice.test.ts` and `src/convex/agentLogic/invoice.test.ts`
- E2E validation script `scripts/test-invoice-agent.sh`

### Security
- Organization APIs in `src/convex/organizations.ts` now enforce authenticated access in production and organization-bound authorization checks for reads/settings updates
- Chat ingress validation now scans all user-role messages in the request payload via `validateMessagesInput` (closing single-last-message bypasses)
- Added `assertUserInOrganization` to `invoices.create`, `invoices.createByLeadName`, `invoices.update`, `invoices.remove`, `invoices.markAsPaidByLeadName`
- Invoice `update` mutation now requires `organizationId` and `userId` args with org ownership checks
- Invoice `remove` mutation now requires `organizationId` and `userId` args with org ownership checks
- Invoice read queries (`get`, `list`, `listByLead`, `getStats`) now enforce org membership and tenant ownership checks
- Moved `createInvoice` from CRM tools to dedicated invoice module for better separation of concerns

#### Reminder Agent (Phase 7b)
- Reminder agent at `src/lib/ai/agents/reminder/` — scans upcoming appointments (24h/48h windows), plans reminder actions via LLM, learns from outcomes
- Convex-side agent logic at `src/convex/agentLogic/reminder.ts` with settings, config, system prompt, prompt builder, and plan validator
- Three reminder actions: `update_appointment_notes`, `update_lead_notes`, `log_reminder_recommendation`
- Idempotent execution via `[Reminder YYYY-MM-DD]` marker in appointment and lead notes
- Reminder runner now skips past appointments, sorts by nearest upcoming time, and deduplicates repeated action targets in a single plan
- Reminder windows and batch size now honor per-organization `agentDefinitions.settings` (with safe defaults/sanitization)
- Appointment Convex APIs (`list`, `get`, `update`, `getUpcoming`, `listByLead`) now enforce org membership and tenant ownership checks
- Extended `agentRunner.ts` with `runReminderAgent` internalAction, `getUpcomingAppointmentsForReminder` query, `getLeadsByIds` query, and `updateAppointmentNotes` mutation
- `runAgentForOrg` now accepts both `'followup'` and `'reminder'` agent types
- Daily reminder agent cron job at 09:00 UTC in `src/convex/crons.ts`
- Agent registry updated — `reminder` mapped to `ReminderHandler` (no longer throws)
- Shared type helper `asAppointmentId()` added to `src/lib/ai/shared/convex.ts`
- Validation test script `scripts/test-reminder-agent.sh` (95 checks across 20 sections)
- Added reminder-focused unit tests: `src/convex/agentRunner.reminder.test.ts` and `src/convex/agentLogic/reminder.test.ts`
- Barrel exports from `src/lib/ai/agents/index.ts` and `src/convex/agentLogic/index.ts`

#### Reminder Agent Chat Integration (Phase 7b+)
- Chat tools: `setReminder` and `listReminders` in `src/lib/ai/tools/reminder.ts` — users can set reminders via conversation ("remind me about my appointment with Sarah")
- Convex public API: `appointments.setReminderByLeadName` (fuzzy name + date match), `appointments.setReminderNote` (by ID), `appointments.getAppointmentsWithReminders` (query)
- System prompt v2 updated with Reminders capability section and tool documentation
- Chat route wired: `createReminderTools` creates tools alongside CRM and memory tools
- Uses same `[Reminder YYYY-MM-DD]` marker as cron agent for idempotency
- All mutations enforce `assertUserInOrganization` for security
- 9 unit tests in `src/lib/ai/tools/reminder.test.ts`
- Blueprint documented in DEVELOPMENT_PLAN.md for wiring future agents (7c/7d) with chat

#### Agent Framework Foundation (Phase 7a)
- Core agent framework at `src/lib/ai/agents/core/` with AgentHandler interface, pipeline runner, risk engine, memory helpers, and guardrail enforcement
- Followup Agent at `src/lib/ai/agents/followup/` — identifies stale leads, plans actions via LLM, learns from outcomes
- Agent registry with type-safe handler factory mapping (`src/lib/ai/agents/registry.ts`)
- Convex persistence: `agentDefinitions` table for per-org agent config, `agentExecutions` table for execution lifecycle tracking
- `agentRunner.ts` Convex internalAction with LLM integration (OpenRouter/OpenAI fallback), structured JSON output, and retry logic
- Daily followup agent cron job (14:00 UTC) in `src/convex/crons.ts`
- Heuristic risk assessment with per-agent overrides and approval thresholds
- Config-driven guardrails: action whitelists, max actions per run, risk level gates
- Agent memory access helpers for reading patterns and recording learnings
- Validation test script `scripts/test-agent-framework.sh` (48+ checks)
- Type exports wired into `src/types/index.ts` and `src/lib/ai/index.ts`

#### Memory Schema & CRUD (Phase 1)
- 4-layer memory hierarchy: `platformMemories`, `nicheMemories`, `businessMemories`, `agentMemories`
- `memoryRelations` and `memoryEvents` tables with full CRUD operations
- Memory validation library (`src/lib/ai/memory/validation.ts`) with content length, confidence, and PII detection
- Centralized memory types in `src/types/index.ts`

#### Embedding & Vector Search (Phase 2)
- Multi-provider embedding service (OpenRouter default, OpenAI fallback) with retry and backoff in `src/convex/embedding.ts`
- 3072-dimension vectors via `text-embedding-3-large`
- Vector search across all 4 memory layers in `src/convex/vectorSearch.ts`
- Hybrid search with Reciprocal Rank Fusion (RRF) in `src/convex/hybridSearch.ts`
- Fuzzy name matching utility in `src/convex/fuzzyMatch.ts`
- Shared embedding constants and math in `src/lib/ai/memory/embedding.ts`
- Auto-embedding on memory create/update via `ctx.scheduler.runAfter`

#### Memory Retrieval & Context (Phase 3)
- Full retrieval pipeline: query analysis, parallel vector search, scoring, token budgeting
- Context formatter for injecting memory into system prompt (`src/lib/ai/memory/contextFormatter.ts`)
- Query analysis with entity extraction and intent detection (`src/lib/ai/memory/queryAnalysis.ts`)
- Scoring with decay-aware and confidence-weighted ranking (`src/lib/ai/memory/scoring.ts`)
- Convex action gateway in `src/convex/memoryRetrieval.ts`
- Early-start parallelism for memory retrieval in chat route

#### Memory Extraction Pipeline (Phase 4)
- LLM-based memory extraction worker in `src/convex/memoryExtraction.ts`
- Extraction prompt with Zod output schema in `src/lib/ai/memory/extractionPrompt.ts`
- Memory event emission in chat route: `conversation_end`, `tool_success`, `tool_failure`
- Deduplication via vector similarity (threshold 0.92) with version chaining
- Cron job for extraction processing every 2 minutes
- Correction-aware extraction and maintenance workflows
- Business memory history fields (`previousVersionId`, `correctedAt`, `correctedBy`)

#### Memory Lifecycle (Phase 5)
- Ebbinghaus-based decay algorithm in `src/lib/ai/memory/decay.ts` with 7 type-specific decay rates
- Decay workers in `src/convex/memoryDecay.ts`: hourly batch updates + on-access boost via scheduler
- TTL management in `src/lib/ai/memory/ttl.ts` with per-type defaults (30 days to never)
- Auto-set `expiresAt` on memory creation in `businessMemories.ts` and `memoryExtraction.ts`
- Archival workers in `src/convex/memoryArchival.ts`:
  - Daily: archive memories with decay score < 0.3
  - Compression: LLM-based summarization with `@convex-dev/action-retrier` for robust retries
  - Weekly: soft-delete expired memories, hard-delete after 90-day retention, orphan relation cleanup
- `by_org_archived` index on `businessMemories` for efficient archival queries
- Scheduled cron jobs: decay (hourly), archival (daily 8:00 UTC), cleanup (weekly Sunday 8:00 UTC)

#### Memory Tools & Chat Integration (Phase 6)
- 4 memory management tools for chat AI in `src/lib/ai/tools/memory.ts`:
  - `rememberFact`: Explicitly store facts, preferences, instructions, and business rules
  - `forgetMemory`: Search and soft-delete matching memories on user request
  - `searchMemories`: Vector search through stored business knowledge
  - `updatePreference`: Upsert preferences with similarity-based dedup (threshold 0.6)
- Lightweight `searchMemories` public action in `src/convex/memoryRetrieval.ts` for tool-level business memory search (single-layer, no scoring/budgeting overhead)
- Conversation summary with sliding window in `src/lib/ai/memory/conversationSummary.ts`:
  - Keeps last 6 messages in full, summarizes older messages via lightweight LLM call
  - Archive threshold at 50+ messages triggers extraction event
  - Summary injected into system prompt via `{{conversation_summary}}` placeholder
- Memory tool instructions added to v2 system prompt with usage guidelines
- Chat route wires memory tools alongside CRM tools, gated behind `enableMemory` feature flag
- End-to-end memory loop: store → retrieve → use → learn (via extraction pipeline)

#### Retrieval Optimization (Phase 6.5)
- Intent-aware layer routing: `memory_command` intent (remember/forget/store) skips retrieval entirely
- Selective layer search: scheduling/lead queries only search business + agent (skip platform + niche)
- `searchSelectedLayers` Convex action in `src/convex/vectorSearch.ts` for partial-layer search
- `retrieveSelectedContext` Convex action in `src/convex/memoryRetrieval.ts` with layer filtering
- Layer routing via `getRequiredLayers()` and `isMemoryCommand()` in `src/lib/ai/memory/queryAnalysis.ts`
- ConvexHttpClient reuse: tools share the route's singleton client instead of creating new ones
- Shared test infrastructure in `scripts/lib/test-helpers.sh` extracted from 4 test scripts

#### Memory Hardening Foundations
- Hybrid dedup optimization: business hybrid search reuses precomputed vector results (no duplicate business vector query)
- Route-level latency improvement: optional niche lookup no longer blocks memory retrieval startup
- Configurable short-TTL caches for memory retrieval + embeddings behind `AI_ENABLE_CACHING`
- Memory event idempotency with `idempotencyKey` + `by_org_idempotency` index to prevent duplicate ingestion
- Event processing state machine (`pending`/`processing`/`processed`/`failed`) with retry counts and dead-letter storage
- Public memory retrieval/event surfaces are token-gated via `MEMORY_API_TOKEN` (with explicit dev bypass)
- `memoryEvents.listByType` is organization-scoped to prevent cross-tenant reads
- Extraction handlers added for `user_correction`, `explicit_instruction`, `approval_*`, and `feedback` events
- TTL consistency for versioned/superseded/consolidated business memory writes
- Added memory compression + lifecycle health-check crons
- Added memory unit tests and CI memory smoke gate
- Added load-test harness for memory retrieval latency (`scripts/load-test-memory.sh`)

#### Developer Tooling
- Dev environment setup script (`scripts/dev-setup.sh`)
- Memory pipeline validation script (`scripts/validate-memory.sh`)
- Phase 4 extraction test script (`scripts/test-extraction-pipeline.sh`)
- Phase 5 lifecycle test script (`scripts/test-decay-lifecycle.sh`)
- Phase 6 memory tools test script (`scripts/test-memory-tools.sh`)
- Shared test helpers library (`scripts/lib/test-helpers.sh`) with reusable colors, counters, output functions, env loading, gates, assertions, and cleanup

### Changed

#### Chat & Retrieval Improvements
- Enriched chat route memory logging context
- Labeled updated business memories in formatted context output
- Expanded short subject queries before retrieval for better matching
- Improved query entity extraction for single and lowercase names
- Gated embedding debug logs behind `DEBUG_MEMORY` flag
- Excluded inactive and archived docs from vector search results
- Standardized retrieval warning context when embeddings are unavailable

#### Chat Route Enhancements (Phase 6)
- Memory tools merged with CRM tools in chat route via spread composition
- Conversation summary applied to long sessions before LLM context
- Parallel resolution of memory retrieval and conversation summary
- Archival memory event emitted for conversations exceeding 50 messages
- `getSystemPrompt` now accepts optional conversation summary parameter

#### Retrieval Performance (Phase 6.5)
- Retrieval pipeline skips entirely for `memory_command` intents (0ms for remember/forget)
- Selective layer search skips platform + niche for scheduling/lead queries (~40% fewer vector searches)
- Tools reuse the chat route's ConvexHttpClient singleton (eliminates redundant connection setup)
- Debug logging now reports skipped layers for visibility into optimization impact

#### Reliability & Observability
- Structured trace propagation from chat route to retrieval (`traceId`)
- Retrieval stage timing logs for analysis/search/scoring/budget/format substeps
- SLO warning logs for retrieval latency and end-to-end chat latency threshold breaches
- CI now enforces a dedicated memory smoke test job

#### Memory System Maturity
- Full lifecycle management: extraction → decay → archival → purge
- Extended background processing coverage for memory maintenance and data hygiene

### Fixed

- Inactive and archived documents appearing in vector search results
- Entity extraction failing on single-word and lowercase names
- Embedding debug logs polluting output in non-debug mode

### Security

- Memory lifecycle controls that reduce stale-memory retention risk through decay thresholds and purge workflows
- Periodic cleanup jobs to limit long-lived inactive data
- TTL filtering prevents expired memories from polluting retrieval
- Updated `SECURITY.md` to cover background memory lifecycle jobs

## [2.1.0] - 2026-02-04

### Added

#### AI Architecture Refactoring
- Centralized AI configuration system with Zod validation
- Environment variable mapping for flexible AI configuration
- Multi-provider AI system with 5 providers (Gateway, Gemini, OpenAI, OpenRouter, Groq)
- Model tier abstraction (smartest/smart/regular) for cost-performance tradeoffs
- AI services layer with monitoring, retry logic, and structured outputs
- Request ID generation for distributed tracing
- Comprehensive monitoring and metrics collection
- Rate limiting utilities for API quota management
- Suggestion generation service with structured output validation
- System and suggestion prompt management with version control
- `.env.ai.example` with comprehensive AI configuration documentation

#### CI/CD Pipeline
- GitHub Actions CI workflow for automated testing and validation
- Automated linting, type checking, and formatting validation
- Build verification for Next.js application
- Security audit integration
- Fast feedback loop (< 5 minutes typical)
- Vercel handles automatic deployments on push to main

#### Code Quality & Developer Experience
- Husky 9.1.7 for Git hooks automation
- Pre-commit hook: Type checking + Biome checks
- Commit message validation (Conventional Commits)
- Pre-push hook: Full validation before remote push
- `validate` script for quick validation

### Changed

#### API & Backend
- Refactored chat API route to use centralized AI configuration
- Improved error handling with structured error objects and request tracking
- Added configurable timeouts with abort signals
- Enhanced authentication flow with proper error responses
- Environment-aware debug logging (disabled in production)

#### Services & Actions
- Migrated suggestions action from direct Gemini calls to service layer
- Simplified suggestion generation (45 lines → 35 lines)
- Added automatic retry logic for transient failures
- Improved token usage tracking and performance metrics

#### UI & Components
- Integrated centralized model store for provider/tier selection
- Cleaned up verbose optimization comments across components
- Simplified ChatContainer, ChatInput, MessageBubble, and TypingIndicator
- Streamlined dashboard components and layouts
- Updated auth layouts and pages for better code clarity

### Removed

- Unused font packages (@fontsource/geist-sans, @fontsource/geist-mono)
- Redundant code comments and documentation
- Unnecessary optimization markers

### Fixed

- Production logging verbosity in Convex auth triggers
- Type safety improvements across AI services
- Error handling edge cases in chat API

### Security

- Request timeout implementation preventing hung connections
- Feature flags for controlled rollout of sensitive features
- Environment-based configuration reduces hardcoded secrets
- Improved error messages without exposing internal details

## [2.0.0] - 2026-02-03

### Added

#### CRM Features
- Natural language chat interface for CRM operations
- Lead management with status tracking (new, contacted, qualified, unqualified, customer)
- Appointment scheduling system with lead linkage
- Invoice generation with line items and due dates
- Real-time data synchronization across all clients
- Chat history persistence with tool call tracking
- Multi-tenant organization support with data isolation

#### AI Integration
- Multi-provider AI support with 5 providers:
  - Vercel AI Gateway (default)
  - Google Gemini (Flash and Pro models)
  - OpenAI (GPT-4o, GPT-4o Mini, o3-mini)
  - OpenRouter (100+ models)
  - Groq (ultra-fast inference with LPU)
- Provider/model selection with persistence
- Streaming responses for real-time interaction
- Tool calling for CRM operations (6 tools)
- Multi-step reasoning (up to 5 steps)

#### Authentication & Security
- Better Auth authentication with email/password
- Secure session management (7-day sessions, 24-hour refresh)
- Rate limiting (10 requests/minute per IP)
- CSRF protection enabled
- Comprehensive security headers (CSP, X-Frame-Options, HSTS)
- Environment variable validation with Zod
- Route protection middleware
- Cookie security (httpOnly, secure in prod, sameSite=lax)

#### UI/UX
- Dark mode by default with amber/orange theme
- Responsive chat interface with markdown support
- Typing indicators for AI responses
- Loading skeletons for better UX
- Error boundaries for graceful error handling
- Dashboard layout with sidebar navigation
- Settings page for AI provider configuration

### Technical

#### Framework & Core
- Next.js 16.1.6 with App Router
- React 19.0.0 with React Server Components
- TypeScript 5.7.0 with strict mode
- Turbopack for fast development builds

#### Backend & Database
- Convex 1.31.7 for real-time backend
- Better Auth 1.4.18 with Convex integration
- Multi-tenant database schema
- Transactional data operations

#### AI & ML
- Vercel AI SDK 6.0.68 with streaming support
- Multiple AI provider SDKs:
  - `@ai-sdk/google` 3.0.20
  - `@ai-sdk/openai` 3.0.25
  - `@ai-sdk/groq` 3.0.21
  - `@openrouter/ai-sdk-provider` 2.1.1

#### Styling & UI
- Tailwind CSS 4.0.0 with PostCSS
- Geist font family (Sans + Mono)
- Lucide React icons 0.563.0
- Custom UI component library

#### State Management & Utils
- Zustand 5.0.11 for client state
- Zod 4.0.1 for schema validation
- React Markdown 10.1.0 for message rendering
- clsx + tailwind-merge for className utilities

#### Development Tools
- Biome 2.3.13 (linter + formatter, replaces ESLint/Prettier)
- Concurrently 9.2.1 for running dev servers
- npm-run-all2 8.0.4 for script orchestration

### Security

- Rate limiting configured (10 req/min per IP, database-backed)
- CSRF protection enabled by default
- XSS protection via httpOnly cookies
- Content Security Policy (CSP) implemented
- Strict-Transport-Security (HSTS) enabled in production
- Environment variable validation
- Secure session management with automatic refresh
- Origin validation for cross-origin requests
- IP tracking for security audits

### Changed

- Migrated from ESLint/Prettier to Biome for unified tooling
- Updated to latest React 19 patterns
- Improved development workflow with concurrent dev servers
- Enhanced security headers configuration

### Fixed

- Session persistence across page reloads
- Type safety improvements across codebase
- Environment variable validation edge cases

## [1.0.0] - Initial Release

Initial prototype with basic functionality.

---

## Release Notes

### Upgrading to 2.0.0

This is a major version with breaking changes:

1. **Node.js Requirement**: Node.js 20.9.0+ required
2. **Bun Preferred**: Project now enforces Bun as package manager
3. **Biome Migration**: Replace ESLint/Prettier configs with Biome
4. **Environment Variables**: New required variables (see `.env.example`)

### What's Next?

**Phase 12 — Memory UI & Admin Dashboard: NEAR-COMPLETE**

Phase 12 deliverables shipped (12.1–12.8):
- Memory viewer with filtering, search, and health indicators (`MemoryViewer`, `MemoryCard`, `MemoryFilters`)
- Agent approval queue and execution log (`ApprovalQueue`, `ApprovalCard`, `ExecutionLog`)
- Analytics dashboards for memory, agents, and cost (`MemoryAnalytics`, `AgentAnalytics`, `CostAnalytics`)
- Context inspector for retrieval debugging (`ContextInspector` — component built, not yet mounted)
- Wired dashboard page at `/memory` combining all 11 components
- Sidebar CRM tabs wired with live Convex data (leads, appointments, invoices)
- Server-side memory stats aggregation replacing client-side 100-item cap

**Planned features for future releases:**
- Email verification and 2FA for authentication
- Calendar integrations (Google Calendar, Outlook)
- Webhook support for external integrations

---

**For detailed security information, see [SECURITY.md](SECURITY.md)**  
**For code style guidelines, see [AGENTS.md](AGENTS.md)**
