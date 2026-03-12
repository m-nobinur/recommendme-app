export type BudgetTier = 'free' | 'starter' | 'pro' | 'enterprise'

export interface TierLimits {
  dailyTokens: number
  monthlyTokens: number
  label: string
}

const TIER_LIMITS: Record<BudgetTier, TierLimits> = {
  free: { dailyTokens: 10_000, monthlyTokens: 200_000, label: 'Free' },
  starter: { dailyTokens: 50_000, monthlyTokens: 1_000_000, label: 'Starter' },
  pro: { dailyTokens: 200_000, monthlyTokens: 5_000_000, label: 'Pro' },
  enterprise: {
    dailyTokens: Number.MAX_SAFE_INTEGER,
    monthlyTokens: Number.MAX_SAFE_INTEGER,
    label: 'Enterprise',
  },
}

export function getTierLimits(tier: BudgetTier): TierLimits {
  return TIER_LIMITS[tier]
}

export type BudgetStatus = 'ok' | 'warning' | 'exceeded'

export interface BudgetCheckResult {
  status: BudgetStatus
  dailyPercent: number
  monthlyPercent: number
  tierLabel: string
}

const WARNING_THRESHOLD = 80

export function checkBudget(
  dailyTokensUsed: number,
  monthlyTokensUsed: number,
  tier: BudgetTier
): BudgetCheckResult {
  const limits = getTierLimits(tier)
  const dailyPercent = limits.dailyTokens > 0 ? (dailyTokensUsed / limits.dailyTokens) * 100 : 0
  const monthlyPercent =
    limits.monthlyTokens > 0 ? (monthlyTokensUsed / limits.monthlyTokens) * 100 : 0

  let status: BudgetStatus = 'ok'
  if (dailyPercent >= 100 || monthlyPercent >= 100) {
    status = 'exceeded'
  } else if (dailyPercent >= WARNING_THRESHOLD || monthlyPercent >= WARNING_THRESHOLD) {
    status = 'warning'
  }

  return {
    status,
    dailyPercent: Math.round(dailyPercent * 100) / 100,
    monthlyPercent: Math.round(monthlyPercent * 100) / 100,
    tierLabel: limits.label,
  }
}

export function isValidTier(tier: string): tier is BudgetTier {
  return tier in TIER_LIMITS
}

export function getAllTiers(): BudgetTier[] {
  return Object.keys(TIER_LIMITS) as BudgetTier[]
}
