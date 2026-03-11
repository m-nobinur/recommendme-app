'use client'

import type { Id } from '@convex/_generated/dataModel'
import { Archive, Clock, Database, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

type MemoryType = 'fact' | 'preference' | 'instruction' | 'context' | 'relationship' | 'episodic'
type MemorySource = 'extraction' | 'explicit' | 'tool' | 'system'

export interface MemoryCardData {
  _id: Id<'businessMemories'>
  type: MemoryType
  content: string
  importance: number
  confidence: number
  decayScore: number
  accessCount: number
  lastAccessedAt: number
  source: MemorySource
  subjectType?: string
  subjectId?: string
  isActive: boolean
  isArchived: boolean
  createdAt: number
  updatedAt: number
}

interface MemoryCardProps {
  memory: MemoryCardData
  onEdit?: (memory: MemoryCardData) => void
  onArchive?: (id: Id<'businessMemories'>) => void
  onDelete?: (id: Id<'businessMemories'>) => void
  className?: string
}

const TYPE_COLORS: Record<MemoryType, string> = {
  fact: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  preference: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  instruction: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  context: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  relationship: 'bg-green-500/20 text-green-400 border-green-500/30',
  episodic: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
}

function HealthBar({ value, label }: { value: number; label: string }) {
  const color =
    value >= 0.7 ? 'bg-status-success' : value >= 0.4 ? 'bg-amber-500' : 'bg-status-error'
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <div className="h-1.5 flex-1 rounded-full bg-surface-elevated">
        <div
          className={cn('h-1.5 rounded-full transition-all', color)}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] text-text-secondary">
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

export function MemoryCard({ memory, onEdit, onArchive, onDelete, className }: MemoryCardProps) {
  const healthColor =
    memory.decayScore >= 0.7
      ? 'border-l-status-success'
      : memory.decayScore >= 0.4
        ? 'border-l-amber-500'
        : 'border-l-status-error'

  const timeAgo = (ts: number) => {
    const seconds = Math.floor((Date.now() - ts) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  return (
    <div
      className={cn(
        'group relative rounded-xl border border-border bg-surface-secondary p-4',
        'border-l-2 transition-all hover:border-border-strong',
        healthColor,
        memory.isArchived && 'opacity-60',
        className
      )}
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              TYPE_COLORS[memory.type]
            )}
          >
            {memory.type}
          </span>
          {memory.subjectType && (
            <span className="rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
              {memory.subjectType}
            </span>
          )}
          {memory.isArchived && (
            <span className="rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
              archived
            </span>
          )}
          {!memory.isActive && !memory.isArchived && (
            <span className="rounded-md border border-status-error/30 bg-status-error/10 px-1.5 py-0.5 text-[10px] text-status-error">
              inactive
            </span>
          )}
        </div>

        {/* Action buttons — visible on hover */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(memory)}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary"
              title="Edit"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {onArchive && !memory.isArchived && (
            <button
              type="button"
              onClick={() => onArchive(memory._id)}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-amber-400"
              title="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(memory._id)}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-status-error/10 hover:text-status-error"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-text-primary">
        {memory.content}
      </p>

      {/* Health bars */}
      <div className="mb-3 space-y-1">
        <HealthBar value={memory.decayScore} label="Decay" />
        <HealthBar value={memory.confidence} label="Conf." />
        <HealthBar value={memory.importance} label="Import." />
      </div>

      {/* Footer meta */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
        <span className="flex items-center gap-1">
          <Eye className="h-3 w-3" />
          {memory.accessCount}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {timeAgo(memory.lastAccessedAt)}
        </span>
        <span className="flex items-center gap-1">
          <Database className="h-3 w-3" />
          {memory.source}
        </span>
      </div>
    </div>
  )
}
