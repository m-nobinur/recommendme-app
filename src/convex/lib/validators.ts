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

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ActorType = 'system' | 'user' | 'agent'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export function boundedPageSize(
  limit: number | undefined,
  defaultLimit: number,
  maxLimit: number
): number {
  const resolved = Math.floor(limit ?? defaultLimit)
  return Math.min(Math.max(resolved, 1), maxLimit)
}
