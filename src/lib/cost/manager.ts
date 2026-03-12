import type { ModelTier } from '@/lib/ai/providers'
import type { BudgetCheckResult, BudgetTier, TierLimits } from './budgets'
import { checkBudget, getTierLimits, isValidTier } from './budgets'

const DEFAULT_BUDGET_TIER: BudgetTier = 'starter'
const DEFAULT_RETRY_AFTER_SECONDS = 60 * 60
const WARNING_CONTEXT_REDUCTION_FACTOR = 0.6
const WARNING_CONVERSATION_WINDOW = 4
const DEFAULT_CONVERSATION_WINDOW = 6

export interface BudgetUsageSnapshot {
  dailyTokensUsed: number
  monthlyTokensUsed: number
}

export interface BudgetRoutingInput {
  requestedTier: ModelTier
  budgetTier?: string
  usage: BudgetUsageSnapshot
}

export interface BudgetRoutingDecision {
  budgetTier: BudgetTier
  limits: TierLimits
  budget: BudgetCheckResult
  requestedTier: ModelTier
  effectiveTier: ModelTier
  reduceContext: boolean
  allowLlmCall: boolean
  retryAfterSeconds?: number
  reason: string
}

export function resolveBudgetTier(rawTier: string | undefined): BudgetTier {
  return rawTier && isValidTier(rawTier) ? rawTier : DEFAULT_BUDGET_TIER
}

export function downgradeModelTier(tier: ModelTier): ModelTier {
  switch (tier) {
    case 'smartest':
      return 'smart'
    case 'smart':
      return 'regular'
    case 'regular':
      return 'regular'
  }
}

export function evaluateBudgetRouting(input: BudgetRoutingInput): BudgetRoutingDecision {
  const budgetTier = resolveBudgetTier(input.budgetTier)
  const limits = getTierLimits(budgetTier)
  const budget = checkBudget(input.usage.dailyTokensUsed, input.usage.monthlyTokensUsed, budgetTier)

  if (budget.status === 'exceeded') {
    return {
      budgetTier,
      limits,
      budget,
      requestedTier: input.requestedTier,
      effectiveTier: 'regular',
      reduceContext: true,
      allowLlmCall: false,
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
      reason: 'Budget limit exceeded for this organization tier.',
    }
  }

  if (budget.status === 'warning') {
    const downgradedTier = downgradeModelTier(input.requestedTier)
    const changedTier = downgradedTier !== input.requestedTier
    return {
      budgetTier,
      limits,
      budget,
      requestedTier: input.requestedTier,
      effectiveTier: downgradedTier,
      reduceContext: true,
      allowLlmCall: true,
      reason: changedTier
        ? `Budget warning threshold reached. Downgraded model tier to ${downgradedTier}.`
        : 'Budget warning threshold reached. Applying reduced context mode.',
    }
  }

  return {
    budgetTier,
    limits,
    budget,
    requestedTier: input.requestedTier,
    effectiveTier: input.requestedTier,
    reduceContext: false,
    allowLlmCall: true,
    reason: 'Budget healthy.',
  }
}

export function getConversationWindowSize(
  decision: Pick<BudgetRoutingDecision, 'reduceContext'>
): number {
  return decision.reduceContext ? WARNING_CONVERSATION_WINDOW : DEFAULT_CONVERSATION_WINDOW
}

export function trimMemoryContextForBudget(
  context: string,
  decision: Pick<BudgetRoutingDecision, 'reduceContext'>
): string {
  if (!decision.reduceContext || context.length === 0) {
    return context
  }

  const maxChars = Math.max(1200, Math.floor(context.length * WARNING_CONTEXT_REDUCTION_FACTOR))
  if (context.length <= maxChars) {
    return context
  }

  const lines = context.split('\n')
  const kept: string[] = []
  let used = 0

  for (const line of lines) {
    const nextSize = used + line.length + 1
    if (nextSize > maxChars) {
      break
    }
    kept.push(line)
    used = nextSize
  }

  if (kept.length === 0) {
    return context
  }

  if (kept[kept.length - 1] === '---') {
    kept.pop()
  }

  kept.push('- [Additional memory context omitted due to budget guardrail]')
  kept.push('---')
  return kept.join('\n')
}
