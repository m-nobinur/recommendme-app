'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { CheckCircle, Clock, XCircle } from 'lucide-react'
import { memo, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils/cn'
import type { ApprovalQueueRow } from './ApprovalCard'
import { ApprovalCard } from './ApprovalCard'

interface ApprovalQueueProps {
  userId: Id<'appUsers'>
  organizationId: Id<'organizations'>
  className?: string
}

type Tab = 'pending' | 'approved' | 'rejected'

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'pending', label: 'Pending', icon: Clock },
  { id: 'approved', label: 'Approved', icon: CheckCircle },
  { id: 'rejected', label: 'Rejected', icon: XCircle },
]

function QueueSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface-secondary p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-12 ml-auto" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
        </div>
      ))}
    </div>
  )
}

export const ApprovalQueue = memo(function ApprovalQueue({
  userId,
  organizationId,
  className,
}: ApprovalQueueProps) {
  const [activeTab, setActiveTab] = useState<Tab>('pending')
  const now = Date.now()

  const pending = useQuery(api.approvalQueue.listPending, {
    userId,
    organizationId,
    now,
    limit: 50,
  }) as ApprovalQueueRow[] | undefined

  const approved = useQuery(api.approvalQueue.listByStatus, {
    userId,
    organizationId,
    status: 'approved',
    limit: 50,
  }) as ApprovalQueueRow[] | undefined

  const rejected = useQuery(api.approvalQueue.listByStatus, {
    userId,
    organizationId,
    status: 'rejected',
    limit: 50,
  }) as ApprovalQueueRow[] | undefined

  const stats = useQuery(api.approvalQueue.getStats, {
    userId,
    organizationId,
    now,
  })

  const items = activeTab === 'pending' ? pending : activeTab === 'approved' ? approved : rejected
  const isLoading = items === undefined

  const pendingCount = stats?.pending ?? pending?.length ?? 0

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <Clock className="h-4 w-4 text-brand" />
          Agent Approval Queue
          {pendingCount > 0 && (
            <span className="rounded-full bg-status-error px-1.5 py-0.5 text-[10px] font-medium text-white">
              {pendingCount}
            </span>
          )}
        </h2>
        {stats && (
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-status-success" />
              {stats.approved ?? 0} approved
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="h-3 w-3 text-status-error" />
              {stats.rejected ?? 0} rejected
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-surface-tertiary p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const count =
            tab.id === 'pending'
              ? pendingCount
              : tab.id === 'approved'
                ? (stats?.approved ?? approved?.length ?? 0)
                : (stats?.rejected ?? rejected?.length ?? 0)
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-surface-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[10px] font-medium',
                    tab.id === 'pending'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-surface-elevated text-text-muted'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <QueueSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary py-12 text-center">
          <Clock className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">
            {activeTab === 'pending' ? 'No pending approvals.' : `No ${activeTab} items yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ApprovalCard
              key={item._id}
              item={item}
              userId={userId}
              organizationId={organizationId}
            />
          ))}
        </div>
      )}
    </div>
  )
})
