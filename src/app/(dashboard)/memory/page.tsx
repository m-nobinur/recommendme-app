import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { MemoryDashboardContainer } from './components/MemoryDashboardContainer'

export const metadata: Metadata = {
  title: 'Memory & Agents - Reme',
  description: 'Manage business memory, agent executions, approvals, and cost analytics',
}

function PageSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )
}

export default function MemoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MemoryDashboardContainer />
    </Suspense>
  )
}
