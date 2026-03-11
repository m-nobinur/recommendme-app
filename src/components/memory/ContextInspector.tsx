'use client'

import type { Id } from '@convex/_generated/dataModel'
import { ChevronDown, ChevronUp, Eye, X } from 'lucide-react'
import { memo, useState } from 'react'
import { cn } from '@/lib/utils/cn'

interface RetrievedMemory {
  id: Id<'businessMemories'>
  content: string
  type: string
  score: number
  layer?: string
  included: boolean
}

interface ContextInspectorProps {
  memories: RetrievedMemory[]
  tokenBudget: number
  tokensUsed: number
  className?: string
}

const SHOW_INSPECTOR =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SHOW_CONTEXT_INSPECTOR === 'true'

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 0.8
      ? 'text-status-success border-status-success/30 bg-status-success/10'
      : score >= 0.5
        ? 'text-amber-400 border-amber-400/30 bg-amber-400/10'
        : 'text-text-muted border-border bg-surface-elevated'
  return (
    <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', color)}>
      {score.toFixed(2)}
    </span>
  )
}

function TokenBar({ used, budget }: { used: number; budget: number }) {
  const pct = budget > 0 ? Math.min(1, used / budget) : 0
  const color = pct >= 0.9 ? 'bg-status-error' : pct >= 0.7 ? 'bg-amber-500' : 'bg-brand'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-surface-elevated">
        <div
          className={cn('h-1.5 rounded-full transition-all', color)}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[10px] text-text-muted">
        {used}/{budget}
      </span>
    </div>
  )
}

export const ContextInspector = memo(function ContextInspector({
  memories,
  tokenBudget,
  tokensUsed,
  className,
}: ContextInspectorProps) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (!SHOW_INSPECTOR || dismissed) return null

  const included = memories.filter((m) => m.included)
  const dropped = memories.filter((m) => !m.included)

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-surface-elevated shadow-2xl',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-brand" />
          <span className="text-xs font-semibold text-text-primary">Context Inspector</span>
          <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-medium text-brand">
            DEV
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded p-0.5 text-text-muted hover:text-text-primary"
            aria-label={open ? 'Collapse inspector' : 'Expand inspector'}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-0.5 text-text-muted hover:text-text-primary"
            aria-label="Dismiss inspector"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Summary row (always visible) */}
      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-muted">
          <span>
            <span className="font-medium text-status-success">{included.length} included</span>
            {dropped.length > 0 && (
              <span className="ml-1 text-text-muted">· {dropped.length} dropped</span>
            )}
          </span>
          <span>token budget</span>
        </div>
        <TokenBar used={tokensUsed} budget={tokenBudget} />
      </div>

      {/* Expanded details */}
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-border">
          {included.length > 0 && (
            <div className="px-3 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-status-success">
                Included ({included.length})
              </p>
              <div className="space-y-1.5">
                {included.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-border bg-surface-secondary p-2"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] capitalize text-text-secondary">
                        {m.type}
                        {m.layer ? ` · ${m.layer}` : ''}
                      </span>
                      <ScoreBadge score={m.score} />
                    </div>
                    <p className="line-clamp-2 text-[11px] text-text-primary">{m.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dropped.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Dropped ({dropped.length})
              </p>
              <div className="space-y-1.5">
                {dropped.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-border bg-surface-primary p-2 opacity-50"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] capitalize text-text-muted">
                        {m.type}
                        {m.layer ? ` · ${m.layer}` : ''}
                      </span>
                      <ScoreBadge score={m.score} />
                    </div>
                    <p className="line-clamp-1 text-[11px] text-text-muted">{m.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {memories.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-text-muted">
              No memories retrieved
            </div>
          )}
        </div>
      )}
    </div>
  )
})
