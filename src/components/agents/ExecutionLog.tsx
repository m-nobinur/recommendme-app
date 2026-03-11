'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { Activity, ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils/cn'

type ExecutionStatus =
  | 'pending'
  | 'loading_context'
  | 'planning'
  | 'risk_assessing'
  | 'executing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'

interface ExecutionRow {
  _id: Id<'agentExecutions'>
  agentType: string
  triggerType: string
  triggerId?: string
  status: ExecutionStatus
  startedAt: number
  completedAt?: number
  errorMessage?: string
  actionsCount?: number
  plansCount?: number
  createdAt: number
}

interface ExecutionLogProps {
  userId: Id<'appUsers'>
  organizationId: Id<'organizations'>
  className?: string
}

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  pending: 'bg-surface-elevated text-text-muted',
  loading_context: 'bg-blue-500/10 text-blue-400',
  planning: 'bg-blue-500/10 text-blue-400',
  risk_assessing: 'bg-amber-500/10 text-amber-400',
  executing: 'bg-amber-500/10 text-amber-400',
  awaiting_approval: 'bg-purple-500/10 text-purple-400',
  completed: 'bg-status-success/10 text-status-success',
  failed: 'bg-status-error/10 text-status-error',
  skipped: 'bg-surface-elevated text-text-muted',
}

const AGENT_TYPES = ['all', 'memory', 'lead', 'crm', 'followup'] as const
const STATUS_FILTERS = ['all', 'completed', 'failed', 'awaiting_approval'] as const

function durationMs(row: ExecutionRow): string {
  if (!row.completedAt) return '—'
  const ms = row.completedAt - row.startedAt
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function ExecutionRow({
  row,
  isExpanded,
  onToggle,
}: {
  row: ExecutionRow
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium capitalize text-text-primary">
            {row.agentType.replace(/_/g, ' ')} agent
          </span>
          <span className="text-[11px] text-text-muted">
            {row.triggerType} · {timeAgo(row.createdAt)}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_STYLES[row.status]
          )}
        >
          {row.status.replace(/_/g, ' ')}
        </span>
        <span className="w-12 shrink-0 text-right text-[11px] text-text-muted">
          {durationMs(row)}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-text-muted">Started</p>
              <p className="text-xs text-text-secondary">
                {new Date(row.startedAt).toLocaleString()}
              </p>
            </div>
            {row.completedAt && (
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                  Completed
                </p>
                <p className="text-xs text-text-secondary">
                  {new Date(row.completedAt).toLocaleString()}
                </p>
              </div>
            )}
            {row.actionsCount !== undefined && (
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                  Actions
                </p>
                <p className="text-xs text-text-secondary">{row.actionsCount}</p>
              </div>
            )}
            {row.triggerId && (
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                  Trigger ID
                </p>
                <p className="truncate font-mono text-[11px] text-text-muted">{row.triggerId}</p>
              </div>
            )}
          </div>
          {row.errorMessage && (
            <div className="mt-3 rounded-lg border border-status-error/20 bg-status-error/5 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">Error</p>
              <p className="text-xs text-status-error">{row.errorMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LogSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3"
        >
          <Skeleton className="h-4 w-4" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  )
}

export const ExecutionLog = memo(function ExecutionLog({
  userId,
  organizationId,
  className,
}: ExecutionLogProps) {
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const executions = useQuery(api.agentExecutions.list, {
    userId,
    organizationId,
    agentType: agentFilter !== 'all' ? agentFilter : undefined,
    status: statusFilter !== 'all' ? (statusFilter as ExecutionStatus) : undefined,
    limit: 50,
  }) as ExecutionRow[] | undefined

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <Activity className="h-4 w-4 text-brand" />
          Execution Log
          {executions !== undefined && (
            <span className="text-xs font-normal text-text-muted">({executions.length})</span>
          )}
        </h2>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-tertiary p-1">
          {AGENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAgentFilter(t)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-all',
                agentFilter === t
                  ? 'bg-surface-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {t === 'all' ? 'All Agents' : `${t}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-tertiary p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-all',
                statusFilter === s
                  ? 'bg-surface-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {s === 'all' ? 'All Statuses' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {executions === undefined ? (
        <LogSkeleton />
      ) : executions.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary py-12 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">No executions found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {executions.map((row) => (
            <ExecutionRow
              key={row._id}
              row={row}
              isExpanded={expandedId === row._id}
              onToggle={() => setExpandedId((prev) => (prev === row._id ? null : row._id))}
            />
          ))}
        </div>
      )}
    </div>
  )
})
