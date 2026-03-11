'use client'

import { Search, X } from 'lucide-react'
import { useCallback } from 'react'
import { cn } from '@/lib/utils/cn'

export type MemoryFilterType =
  | 'all'
  | 'fact'
  | 'preference'
  | 'instruction'
  | 'context'
  | 'relationship'
  | 'episodic'
export type MemoryFilterStatus = 'active' | 'archived' | 'all'
export type MemoryFilterHealth = 'all' | 'healthy' | 'degraded' | 'critical'

export interface MemoryFiltersState {
  type: MemoryFilterType
  status: MemoryFilterStatus
  health: MemoryFilterHealth
  search: string
}

interface MemoryFiltersProps {
  filters: MemoryFiltersState
  onChange: (filters: MemoryFiltersState) => void
  totalCount?: number
  filteredCount?: number
  className?: string
}

const TYPE_OPTIONS: { value: MemoryFilterType; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'fact', label: 'Facts' },
  { value: 'preference', label: 'Preferences' },
  { value: 'instruction', label: 'Instructions' },
  { value: 'context', label: 'Context' },
  { value: 'relationship', label: 'Relationships' },
  { value: 'episodic', label: 'Episodic' },
]

const STATUS_OPTIONS: { value: MemoryFilterStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

const HEALTH_OPTIONS: { value: MemoryFilterHealth; label: string }[] = [
  { value: 'all', label: 'All Health' },
  { value: 'healthy', label: 'Healthy (>70%)' },
  { value: 'degraded', label: 'Degraded (40-70%)' },
  { value: 'critical', label: 'Critical (<40%)' },
]

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1 text-xs font-medium transition-all',
        active
          ? 'border-brand/50 bg-brand/10 text-brand'
          : 'border-border bg-surface-tertiary text-text-secondary hover:border-border-strong hover:text-text-primary'
      )}
    >
      {label}
    </button>
  )
}

export function MemoryFilters({
  filters,
  onChange,
  totalCount,
  filteredCount,
  className,
}: MemoryFiltersProps) {
  const update = useCallback(
    (partial: Partial<MemoryFiltersState>) => onChange({ ...filters, ...partial }),
    [filters, onChange]
  )

  const hasActiveFilters =
    filters.type !== 'all' ||
    filters.status !== 'active' ||
    filters.health !== 'all' ||
    filters.search !== ''

  const clearAll = useCallback(
    () => onChange({ type: 'all', status: 'active', health: 'all', search: '' }),
    [onChange]
  )

  return (
    <div className={cn('space-y-3', className)}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          placeholder="Search memories..."
          className={cn(
            'w-full rounded-xl border border-border bg-surface-tertiary py-2 pl-9 pr-9 text-sm',
            'text-text-primary placeholder:text-text-muted',
            'focus:border-brand/50 focus:outline-none focus:ring-0 transition-colors'
          )}
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => update({ search: '' })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            label={opt.label}
            active={filters.type === opt.value}
            onClick={() => update({ type: opt.value })}
          />
        ))}
      </div>

      {/* Status + Health */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-muted uppercase tracking-wide mr-1">Status:</span>
          {STATUS_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.status === opt.value}
              onClick={() => update({ status: opt.value })}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-muted uppercase tracking-wide mr-1">Health:</span>
          {HEALTH_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.health === opt.value}
              onClick={() => update({ health: opt.value })}
            />
          ))}
        </div>

        {/* Count + clear */}
        <div className="ml-auto flex items-center gap-2">
          {totalCount !== undefined && (
            <span className="text-xs text-text-muted">
              {filteredCount ?? totalCount} / {totalCount}
            </span>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-brand transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
