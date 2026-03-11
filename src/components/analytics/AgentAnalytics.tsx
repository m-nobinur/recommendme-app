'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { Activity } from 'lucide-react'
import { memo } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/lib/utils/cn'

interface AgentAnalyticsProps {
  userId: Id<'appUsers'>
  organizationId: Id<'organizations'>
  className?: string
}

const AGENT_COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#22d3ee', '#34d399', '#fb7185']

const STATUS_COLORS: Record<string, string> = {
  completed: '#34d399',
  failed: '#fb7185',
  skipped: '#6b7280',
  awaiting_approval: '#f59e0b',
  pending: '#60a5fa',
  loading_context: '#60a5fa',
  planning: '#a78bfa',
  risk_assessing: '#a78bfa',
  executing: '#22d3ee',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export const AgentAnalytics = memo(function AgentAnalytics({
  userId,
  organizationId,
}: AgentAnalyticsProps) {
  const now = Date.now()

  const executions = useQuery(api.agentExecutions.list, {
    userId,
    organizationId,
    limit: 100,
  })

  const approvalStats = useQuery(api.approvalQueue.getStats, {
    userId,
    organizationId,
    now,
  })

  if (executions === undefined || approvalStats === undefined) {
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

  // Aggregate by agent type
  const byAgentType: Record<
    string,
    {
      total: number
      completed: number
      failed: number
      skipped: number
      totalDurationMs: number
      durationCount: number
    }
  > = {}
  for (const exec of executions) {
    const key = exec.agentType
    if (!byAgentType[key]) {
      byAgentType[key] = {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        totalDurationMs: 0,
        durationCount: 0,
      }
    }
    byAgentType[key].total++
    if (exec.status === 'completed') byAgentType[key].completed++
    else if (exec.status === 'failed') byAgentType[key].failed++
    else if (exec.status === 'skipped') byAgentType[key].skipped++
    if (exec.completedAt && exec.startedAt) {
      byAgentType[key].totalDurationMs += exec.completedAt - exec.startedAt
      byAgentType[key].durationCount++
    }
  }

  const agentData = Object.entries(byAgentType)
    .map(([agentType, data], i) => ({
      name: agentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      key: agentType,
      total: data.total,
      completed: data.completed,
      failed: data.failed,
      skipped: data.skipped,
      successRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
      avgDurationMs:
        data.durationCount > 0 ? Math.round(data.totalDurationMs / data.durationCount) : 0,
      color: AGENT_COLORS[i % AGENT_COLORS.length],
    }))
    .sort((a, b) => b.total - a.total)

  // Status distribution across all executions
  const statusCounts: Record<string, number> = {}
  for (const exec of executions) {
    statusCounts[exec.status] = (statusCounts[exec.status] ?? 0) + 1
  }
  const statusData = Object.entries(statusCounts)
    .map(([status, count]) => ({
      name: status.replace(/_/g, ' '),
      key: status,
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const totalExecutions = executions.length
  const totalCompleted = executions.filter((e) => e.status === 'completed').length
  const totalFailed = executions.filter((e) => e.status === 'failed').length
  const overallSuccessRate =
    totalExecutions > 0 ? Math.round((totalCompleted / totalExecutions) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-brand" />
        <h2 className="text-base font-semibold text-white">Agent Analytics</h2>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Executions" value={String(totalExecutions)} sub="last 100 runs" />
        <StatCard
          label="Success Rate"
          value={`${overallSuccessRate}%`}
          sub={`${totalCompleted} completed`}
        />
        <StatCard label="Failed" value={String(totalFailed)} sub="last 100 runs" />
        <StatCard
          label="Pending Approvals"
          value={String(approvalStats.pending)}
          sub={`${approvalStats.expired} expired`}
        />
      </div>

      {/* Executions by agent type — Bar */}
      {agentData.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-secondary p-5">
          <p className="mb-4 text-sm font-medium text-text-secondary">Executions by Agent Type</p>
          <ResponsiveContainer width="100%" height={Math.max(120, agentData.length * 44)}>
            <BarChart
              data={agentData}
              layout="vertical"
              margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(val, name) => [
                  val,
                  name === 'total' ? 'Total' : name === 'completed' ? 'Completed' : 'Failed',
                ]}
                contentStyle={{
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {agentData.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Success rate table */}
          <div className="mt-4 space-y-2">
            {agentData.map((entry) => (
              <div key={entry.key} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-text-secondary">{entry.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-text-muted">
                    avg {entry.avgDurationMs > 0 ? formatDuration(entry.avgDurationMs) : '—'}
                  </span>
                  <span
                    className={cn(
                      'font-medium',
                      entry.successRate >= 80
                        ? 'text-status-success'
                        : entry.successRate >= 50
                          ? 'text-amber-500'
                          : 'text-status-error'
                    )}
                  >
                    {entry.successRate}% success
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status distribution */}
      {statusData.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-secondary p-5">
          <p className="mb-4 text-sm font-medium text-text-secondary">Status Distribution</p>
          <div className="flex flex-wrap gap-2">
            {statusData.map((entry) => (
              <div
                key={entry.key}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[entry.key] ?? '#6b7280' }}
                />
                <span className="capitalize text-text-secondary">{entry.name}</span>
                <span className="font-medium text-text-primary">{entry.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalExecutions === 0 && (
        <div className="rounded-xl border border-border bg-surface-secondary p-10 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">No agent executions yet</p>
          <p className="mt-1 text-xs text-text-muted">
            Executions will appear here once agents start running
          </p>
        </div>
      )}
    </div>
  )
})
