'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { DollarSign } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/lib/utils/cn'

interface CostAnalyticsProps {
  organizationId: Id<'organizations'>
  budgetTier?: 'free' | 'starter' | 'pro' | 'enterprise'
  className?: string
}

const BUDGET_TIER_LIMITS: Record<
  'free' | 'starter' | 'pro' | 'enterprise',
  { dailyLimitTokens: number; monthlyLimitTokens: number }
> = {
  free: { dailyLimitTokens: 100_000, monthlyLimitTokens: 1_000_000 },
  starter: { dailyLimitTokens: 500_000, monthlyLimitTokens: 5_000_000 },
  pro: { dailyLimitTokens: 1_000_000, monthlyLimitTokens: 20_000_000 },
  enterprise: { dailyLimitTokens: 5_000_000, monthlyLimitTokens: 100_000_000 },
}

const PURPOSE_COLORS: Record<string, string> = {
  chat: '#60a5fa',
  memory_extraction: '#f59e0b',
  memory_retrieval: '#a78bfa',
  agent_planning: '#22d3ee',
  agent_execution: '#34d399',
  quality_monitoring: '#fb7185',
  embeddings: '#6b7280',
}

const MODEL_COLORS = [
  '#60a5fa',
  '#f59e0b',
  '#a78bfa',
  '#22d3ee',
  '#34d399',
  '#fb7185',
  '#f97316',
  '#84cc16',
]

const NOW_REFRESH_MS = 30_000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`
  if (usd < 1) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function BudgetBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(1, used / limit) : 0
  const color = pct >= 0.9 ? 'bg-status-error' : pct >= 0.7 ? 'bg-amber-500' : 'bg-status-success'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">
          {formatTokens(used)} / {formatTokens(limit)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-elevated">
        <div
          className={cn('h-2 rounded-full transition-all', color)}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  )
}

export const CostAnalytics = memo(function CostAnalytics({
  organizationId,
  budgetTier = 'pro',
}: CostAnalyticsProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), NOW_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const sinceMs = nowMs - THIRTY_DAYS_MS

  const { dailyLimitTokens, monthlyLimitTokens } = BUDGET_TIER_LIMITS[budgetTier]

  const usage = useQuery(api.llmUsage.getOrgUsage, {
    organizationId,
    sinceMs,
    limit: 500,
  })

  const budget = useQuery(api.llmUsage.getOrgBudgetStatus, {
    organizationId,
    dailyLimitTokens,
    monthlyLimitTokens,
    nowMs,
  })

  const purposeData = useMemo(
    () =>
      usage
        ? Object.entries(usage.byPurpose)
            .map(([purpose, data]) => ({
              name: purpose.replace(/_/g, ' '),
              key: purpose,
              value: data.costUsd,
              tokens: data.tokens,
            }))
            .sort((a, b) => b.value - a.value)
        : [],
    [usage]
  )

  const modelData = useMemo(
    () =>
      usage
        ? Object.entries(usage.byModel)
            .map(([model, data], i) => ({
              name: model.split('/').pop() ?? model,
              fullName: model,
              costUsd: data.costUsd,
              tokens: data.tokens,
              color: MODEL_COLORS[i % MODEL_COLORS.length],
            }))
            .sort((a, b) => b.costUsd - a.costUsd)
            .slice(0, 8)
        : [],
    [usage]
  )

  if (usage === undefined) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-brand" />
        <h2 className="text-base font-semibold text-white">Cost Analytics (30d)</h2>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Cost" value={formatCost(usage.totalCostUsd)} sub="last 30 days" />
        <StatCard label="Total Tokens" value={formatTokens(usage.totalTokens)} />
        <StatCard label="Input Tokens" value={formatTokens(usage.totalInputTokens)} />
        <StatCard label="Output Tokens" value={formatTokens(usage.totalOutputTokens)} />
      </div>

      {/* Budget status */}
      {budget && (
        <div className="rounded-xl border border-border bg-surface-secondary p-5">
          <p className="mb-4 text-sm font-medium text-text-secondary">Token Budget</p>
          <div className="space-y-3">
            <BudgetBar
              label="Daily"
              used={budget.daily.tokensUsed}
              limit={budget.daily.tokenLimit}
            />
            <BudgetBar
              label="Monthly"
              used={budget.monthly.tokensUsed}
              limit={budget.monthly.tokenLimit}
            />
          </div>
        </div>
      )}

      {/* Cost by purpose — Pie */}
      {purposeData.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-secondary p-5">
          <p className="mb-4 text-sm font-medium text-text-secondary">Cost by Purpose</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={purposeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {purposeData.map((entry) => (
                    <Cell key={entry.key} fill={PURPOSE_COLORS[entry.key] ?? '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val) => (typeof val === 'number' ? formatCost(val) : '')}
                  contentStyle={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1.5">
              {purposeData.map((entry) => (
                <div key={entry.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PURPOSE_COLORS[entry.key] ?? '#6b7280' }}
                  />
                  <span className="w-32 truncate capitalize text-text-secondary">{entry.name}</span>
                  <span className="font-medium text-text-primary">{formatCost(entry.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cost by model — Bar */}
      {modelData.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-secondary p-5">
          <p className="mb-4 text-sm font-medium text-text-secondary">Cost by Model</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={modelData}
              layout="vertical"
              margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCost(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={90}
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(val) => (typeof val === 'number' ? formatCost(val) : '')}
                contentStyle={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="costUsd" radius={[0, 4, 4, 0]}>
                {modelData.map((entry) => (
                  <Cell key={entry.fullName} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
})
