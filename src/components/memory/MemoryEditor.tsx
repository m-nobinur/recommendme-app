'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation } from 'convex/react'
import { X } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils/cn'
import { showToast } from '@/lib/utils/toast'
import type { MemoryType } from '@/types'
import type { MemoryCardData } from './MemoryCard'

interface MemoryEditorProps {
  memory?: MemoryCardData
  organizationId: Id<'organizations'>
  userId: Id<'appUsers'>
  onClose: () => void
}

const MEMORY_TYPES: MemoryType[] = [
  'fact',
  'preference',
  'instruction',
  'context',
  'relationship',
  'episodic',
]

const MemoryEditor = memo(function MemoryEditor({
  memory,
  organizationId,
  onClose,
}: MemoryEditorProps) {
  const isEditing = !!memory

  const [content, setContent] = useState(memory?.content ?? '')
  const [type, setType] = useState<MemoryType>(memory?.type ?? 'fact')
  const [subjectType, setSubjectType] = useState(memory?.subjectType ?? '')
  const [subjectId, setSubjectId] = useState(memory?.subjectId ?? '')
  const [importance, setImportance] = useState(memory?.importance ?? 0.5)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation(api.businessMemories.create)
  const updateMutation = useMutation(api.businessMemories.update)

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      setError('Content is required.')
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      if (isEditing && memory) {
        await updateMutation({
          id: memory._id,
          organizationId,
          content: content.trim(),
          importance,
        })
      } else {
        await createMutation({
          organizationId,
          type,
          content: content.trim(),
          subjectType: subjectType.trim() || undefined,
          subjectId: subjectId.trim() || undefined,
          importance,
          confidence: 0.8,
          source: 'explicit',
        })
      }
      showToast('success', isEditing ? 'Memory updated' : 'Memory created')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
      showToast('error', isEditing ? 'Failed to update memory' : 'Failed to create memory')
    } finally {
      setIsSaving(false)
    }
  }, [
    content,
    isEditing,
    memory,
    createMutation,
    updateMutation,
    organizationId,
    type,
    subjectType,
    subjectId,
    importance,
    onClose,
  ])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-secondary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold text-white">{isEditing ? 'Edit Memory' : 'Add Memory'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* Type selector — only for create */}
          {!isEditing && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
                Type
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MEMORY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      'rounded-lg border px-3 py-1 text-xs font-medium capitalize transition-all',
                      type === t
                        ? 'border-brand/50 bg-brand/10 text-brand'
                        : 'border-border bg-surface-tertiary text-text-secondary hover:border-border-strong'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div>
            <label
              htmlFor="memory-content"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
            >
              Content
            </label>
            <textarea
              id="memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="What should Reme remember?"
              className={cn(
                'w-full rounded-xl border border-border bg-surface-tertiary px-3 py-2.5 text-sm',
                'resize-none text-text-primary placeholder:text-text-muted',
                'transition-colors focus:border-brand/50 focus:outline-none'
              )}
            />
          </div>

          {/* Subject fields — only for create */}
          {!isEditing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="memory-subject-type"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
                >
                  Subject Type (optional)
                </label>
                <input
                  id="memory-subject-type"
                  type="text"
                  value={subjectType}
                  onChange={(e) => setSubjectType(e.target.value)}
                  placeholder="e.g. lead, service"
                  className={cn(
                    'w-full rounded-xl border border-border bg-surface-tertiary px-3 py-2 text-sm',
                    'text-text-primary placeholder:text-text-muted',
                    'transition-colors focus:border-brand/50 focus:outline-none'
                  )}
                />
              </div>
              <div>
                <label
                  htmlFor="memory-subject-id"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
                >
                  Subject ID (optional)
                </label>
                <input
                  id="memory-subject-id"
                  type="text"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  placeholder="Entity ID"
                  className={cn(
                    'w-full rounded-xl border border-border bg-surface-tertiary px-3 py-2 text-sm',
                    'text-text-primary placeholder:text-text-muted',
                    'transition-colors focus:border-brand/50 focus:outline-none'
                  )}
                />
              </div>
            </div>
          )}

          {/* Importance slider */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="memory-importance"
                className="text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Importance
              </label>
              <span className="font-mono text-xs text-brand">{Math.round(importance * 100)}%</span>
            </div>
            <input
              id="memory-importance"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <div className="mt-1 flex justify-between text-[10px] text-text-muted">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-status-error">{error}</p>}

          {/* Previous content preview — editing only */}
          {isEditing && memory?.content && memory.content !== content && (
            <div className="rounded-lg border border-border bg-surface-tertiary p-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                Previous content
              </p>
              <p className="line-clamp-2 text-xs text-text-secondary">{memory.content}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} isLoading={isSaving}>
            {isEditing ? 'Save Changes' : 'Add Memory'}
          </Button>
        </div>
      </div>
    </div>
  )
})

export { MemoryEditor }
