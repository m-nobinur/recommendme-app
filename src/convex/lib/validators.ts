import { v } from 'convex/values'

export const riskLevelValues = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('critical')
)

export const actorTypeValues = v.union(v.literal('system'), v.literal('user'), v.literal('agent'))

export const approvalStatusValues = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('expired')
)

export const spanTypeValues = v.union(
  v.literal('api'),
  v.literal('llm'),
  v.literal('retrieval'),
  v.literal('tool'),
  v.literal('agent'),
  v.literal('internal')
)

export const spanStatusValues = v.union(v.literal('ok'), v.literal('error'))

export const llmPurposeValues = v.union(
  v.literal('chat'),
  v.literal('extraction'),
  v.literal('embedding'),
  v.literal('agent'),
  v.literal('summary'),
  v.literal('compression')
)

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ActorType = 'system' | 'user' | 'agent'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type SpanType = 'api' | 'llm' | 'retrieval' | 'tool' | 'agent' | 'internal'
export type SpanStatus = 'ok' | 'error'
export type LLMPurpose = 'chat' | 'extraction' | 'embedding' | 'agent' | 'summary' | 'compression'

export function boundedPageSize(
  limit: number | undefined,
  defaultLimit: number,
  maxLimit: number
): number {
  const resolved = Math.floor(limit ?? defaultLimit)
  return Math.min(Math.max(resolved, 1), maxLimit)
}
