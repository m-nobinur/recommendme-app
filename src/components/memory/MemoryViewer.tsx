'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { Brain } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import type { MemoryCardData } from './MemoryCard'
import { MemoryCard } from './MemoryCard'
import { MemoryEditor } from './MemoryEditor'
import type { MemoryFiltersState } from './MemoryFilters'
import { MemoryFilters } from './MemoryFilters'

interface MemoryViewerProps {
  organizationId: Id<'organizations'>
  userId: Id<'appUsers'>
  className?: string
}

function applyFilters(memories: MemoryCardData[], filters: MemoryFiltersState): MemoryCardData[] {
  return memories.filter((m) => {
    if (filters.type !== 'all' && m.type !== filters.type) return false
    if (filters.status === 'active' && (m.isArchived || !m.isActive)) return false
    if (filters.status === 'archived' && !m.isArchived) return false
    if (filters.health === 'healthy' && m.decayScore < 0.7) return false
    if (filters.health === 'degraded' && (m.decayScore < 0.4 || m.decayScore >= 0.7)) return false
    if (filters.health === 'critical' && m.decayScore >= 0.4) return false
    if (
      filters.search &&
      !m.content.toLowerCase().includes(filters.search.toLowerCase()) &&
      !(m.subjectType ?? '').toLowerCase().includes(filters.search.toLowerCase())
    )
      return false
    return true
  })
}

function MemoryViewerSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface-secondary p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="space-y-1.5">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

const MemoryViewer = memo(function MemoryViewer({
  organizationId,
  userId,
  className,
}: MemoryViewerProps) {
  const [filters, setFilters] = useState<MemoryFiltersState>({
    type: 'all',
    status: 'active',
    health: 'all',
    search: '',
  })
  const [editingMemory, setEditingMemory] = useState<MemoryCardData | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Real-time Convex subscription
  const memories = useQuery(api.businessMemories.list, {
    organizationId,
    activeOnly: filters.status === 'active',
    includeArchived: filters.status === 'archived' || filters.status === 'all',
    type:
      filters.type !== 'all' ? (filters.type as Exclude<typeof filters.type, 'all'>) : undefined,
    limit: 100,
  }) as MemoryCardData[] | undefined

  const archiveMutation = useMutation(api.businessMemories.archive)
  const deleteMutation = useMutation(api.businessMemories.softDelete)

  const filtered = useMemo(
    () => (memories ? applyFilters(memories, filters) : []),
    [memories, filters]
  )

  const handleArchive = useCallback(
    async (id: Id<'businessMemories'>) => {
      try {
        await archiveMutation({ id, organizationId })
      } catch (err) {
        console.error('Archive error:', err)
      }
    },
    [archiveMutation, organizationId]
  )

  const handleDelete = useCallback(
    async (id: Id<'businessMemories'>) => {
      if (!confirm('Delete this memory? This cannot be undone.')) return
      try {
        await deleteMutation({ id, organizationId })
      } catch (err) {
        console.error('Delete error:', err)
      }
    },
    [deleteMutation, organizationId]
  )

  return (
    <div className={className}>
      {/* Filters */}
      <MemoryFilters
        filters={filters}
        onChange={setFilters}
        totalCount={memories?.length}
        filteredCount={filtered.length}
        className="mb-5"
      />

      {/* Header + Add button */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-white text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-brand" />
          Business Memories
          {memories !== undefined && (
            <span className="text-xs font-normal text-text-muted">({filtered.length})</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
        >
          + Add Memory
        </button>
      </div>

      {/* List */}
      {memories === undefined ? (
        <MemoryViewerSkeleton />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary py-12 text-center">
          <Brain className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">
            {memories.length === 0 ? 'No memories yet.' : 'No memories match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((memory) => (
            <MemoryCard
              key={memory._id}
              memory={memory}
              onEdit={setEditingMemory}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Editor modal */}
      {(editingMemory || isCreating) && (
        <MemoryEditor
          memory={editingMemory ?? undefined}
          organizationId={organizationId}
          userId={userId}
          onClose={() => {
            setEditingMemory(null)
            setIsCreating(false)
          }}
        />
      )}
    </div>
  )
})

export { MemoryViewer }
