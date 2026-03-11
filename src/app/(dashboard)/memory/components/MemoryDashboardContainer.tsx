'use client'

import { api } from '@convex/_generated/api'
import { useQuery } from 'convex/react'
import { memo, useState } from 'react'
import { ApprovalQueue } from '@/components/agents/ApprovalQueue'
import { ExecutionLog } from '@/components/agents/ExecutionLog'
import { AgentAnalytics } from '@/components/analytics/AgentAnalytics'
import { CostAnalytics } from '@/components/analytics/CostAnalytics'
import { MemoryAnalytics } from '@/components/analytics/MemoryAnalytics'
import { ContextInspector } from '@/components/memory/ContextInspector'
import { MemoryViewer } from '@/components/memory/MemoryViewer'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils/cn'

type ActiveTab = 'memory' | 'agents' | 'analytics'

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'memory', label: 'Memory' },
  { id: 'agents', label: 'Agents' },
  { id: 'analytics', label: 'Analytics' },
]

function DashboardSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  )
}

export const MemoryDashboardContainer = memo(function MemoryDashboardContainer() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('memory')

  const authUser = useQuery(api.auth.getCurrentUser)
  const appUser = useQuery(
    api.appUsers.getAppUserByAuthId,
    authUser?._id ? { authUserId: authUser._id } : 'skip'
  )

  if (authUser === undefined || appUser === undefined) {
    return <DashboardSkeleton />
  }

  if (!appUser) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-text-muted">
          Unable to load your profile. Please refresh the page.
        </p>
      </div>
    )
  }

  const { _id: userId, organizationId } = appUser

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border bg-surface-primary px-6 pt-4">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border border-b-0 border-border bg-surface-secondary text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'memory' && (
          <div className="space-y-6">
            <MemoryViewer organizationId={organizationId} userId={userId} />
            {/* ContextInspector is shown only when env flag is set */}
            <ContextInspector memories={[]} tokenBudget={4096} tokensUsed={0} />
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="space-y-6">
            <ApprovalQueue userId={userId} organizationId={organizationId} />
            <ExecutionLog userId={userId} organizationId={organizationId} />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <MemoryAnalytics userId={userId} organizationId={organizationId} />
            <AgentAnalytics userId={userId} organizationId={organizationId} />
            <CostAnalytics organizationId={organizationId} />
          </div>
        )}
      </div>
    </div>
  )
})
