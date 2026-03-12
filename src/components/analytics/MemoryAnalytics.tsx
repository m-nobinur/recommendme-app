'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { Brain } from 'lucide-react'
import { memo, useMemo } from 'react'
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

interface MemoryAnalyticsProps {
  userId: Id<'appUsers'>
  organizationId: Id<'organizations'>
  className?: string
}

const TYPE_COLORS: Record<string, string> = {
  fact: '#60a5fa',
  preference: '#f59e0b',
  instruction: '#a78bfa',
  context: '#22d3ee',
  relationship: '#34d399',
  episodic: '#fb7185',
}

const DECAY_BANDS = [
  { range: '0–20%', min: 0, max: 0.2, color: '#ef4444' },
  { range: '20–40%', min: 0.2, max: 0.4, color: '#f97316' },
  { range: '40–60%', min: 0.4, max: 0.6, color: '#eab308' },
  { range: '60–80%', min: 0.6, max: 0.8, color: '#84cc16' },
  { range: '80–100%', min: 0.8, max: 1.01, color: '#22c55e' },
]

export const MemoryAnalytics = memo(function MemoryAnalytics({
  organizationId,
}: MemoryAnalyticsProps) {
  const snapshot = useQuery(api.analyticsWorker.getLatestSnapshot, { organizationId })
  const liveStats = useQuery(
    api.businessMemories.getStats,
    snapshot === null ? { organizationId } : 'skip'
  )

  const stats = useMemo(() => {
    if (snapshot?.memory) {
      return {
        total: snapshot.memory.totalActive + snapshot.memory.totalArchived,
        totalActive: snapshot.memory.totalActive,
        totalArchived: snapshot.memory.totalArchived,
        avgDecay: Math.round(snapshot.memory.avgDecayScore * 100),
        typeCounts: (snapshot.memory.byType ?? {}) as Record<string, number>,
        decayBands: {} as Record<string, number>,
        capped: false,
        source: 'snapshot' as const,
      }
    }
    if (liveStats) return { ...liveStats, source: 'live' as const }
    return undefined
  }, [snapshot, liveStats])

  const typeChartData = useMemo(
    () =>
      stats
        ? Object.entries(stats.typeCounts).map(([type, count]) => ({
            name: type,
            value: count,
            color: TYPE_COLORS[type] ?? '#6b7280',
          }))
        : [],
    [stats]
  )

  const decayChartData = useMemo(
    () =>
      stats
        ? DECAY_BANDS.map((b) => ({
            name: b.range,
            count: stats.decayBands[b.range] ?? 0,
            color: b.color,
          }))
        : [],
    [stats]
  )

  if (stats === undefined) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const { total, totalActive, totalArchived, avgDecay } = stats

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-brand" />
        <h2 className="text-base font-semibold text-white">Memory Analytics</h2>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Memories" value={total} centered />
        <StatCard label="Active" value={totalActive} centered />
        <StatCard label="Archived" value={totalArchived} centered />
        <StatCard label="Avg Decay" value={`${avgDecay}%`} centered />
      </div>
      {stats.source === 'live' && stats.capped && (
        <p className="text-xs text-text-secondary">
          Stats aggregated from the most recent 500 active + 200 archived memories.
        </p>
      )}
      {stats.source === 'snapshot' && (
        <p className="text-xs text-text-secondary">
          Pre-computed daily snapshot. Decay bands require live data.
        </p>
      )}

      {/* Type distribution — Pie */}
      <div className="rounded-xl border border-border bg-surface-secondary p-5">
        <p className="mb-4 text-sm font-medium text-text-secondary">Memory by Type</p>
        {typeChartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">No data yet.</p>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={typeChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {typeChartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    color: 'var(--color-text-primary)',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1.5">
              {typeChartData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="w-20 capitalize text-text-secondary">{entry.name}</span>
                  <span className="font-medium text-text-primary">{entry.value}</span>
                  <span className="text-text-muted">
                    ({total > 0 ? Math.round((entry.value / total) * 100) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Decay distribution — Bar */}
      <div className="rounded-xl border border-border bg-surface-secondary p-5">
        <p className="mb-4 text-sm font-medium text-text-secondary">Decay Score Distribution</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={decayChartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-text-primary)',
                fontSize: '12px',
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {decayChartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
