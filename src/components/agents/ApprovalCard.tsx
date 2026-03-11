'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation } from 'convex/react'
import { AlertTriangle, Check, Clock, X } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils/cn'

type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ApprovalQueueRow {
  _id: Id<'approvalQueue'>
  agentType: string
  action: string
  target?: string
  description: string
  riskLevel: RiskLevel
  context?: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  canReview?: boolean
  rejectionReason?: string
  reviewedAt?: number
}

interface ApprovalCardProps {
  item: ApprovalQueueRow
  userId: Id<'appUsers'>
  organizationId: Id<'organizations'>
}

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'border-l-status-success',
  medium: 'border-l-amber-500',
  high: 'border-l-status-error',
  critical: 'border-l-purple-500',
}

const RISK_BADGES: Record<RiskLevel, string> = {
  low: 'bg-status-success/10 text-status-success border-status-success/30',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  high: 'bg-status-error/10 text-status-error border-status-error/30',
  critical: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
}

const STATUS_STYLES: Record<string, string> = {
  approved: 'text-status-success',
  rejected: 'text-status-error',
  expired: 'text-text-muted',
  pending: 'text-amber-400',
}

function useCountdown(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now())
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  if (remaining === 0) return 'Expired'
  if (hours > 0) return `${hours}h ${minutes}m`
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export const ApprovalCard = memo(function ApprovalCard({
  item,
  userId,
  organizationId,
}: ApprovalCardProps) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localStatus, setLocalStatus] = useState<string>(item.status)

  const reviewMutation = useMutation(api.approvalQueue.review)
  const countdown = useCountdown(item.expiresAt)

  const handleDecision = useCallback(
    async (decision: 'approve' | 'reject') => {
      if (decision === 'reject' && !showRejectInput) {
        setShowRejectInput(true)
        return
      }
      setIsSubmitting(true)
      try {
        const result = await reviewMutation({
          userId,
          organizationId,
          id: item._id,
          decision,
          rejectionReason: decision === 'reject' ? rejectionReason || undefined : undefined,
        })
        setLocalStatus(result.status)
        setShowRejectInput(false)
      } catch (err) {
        console.error('Review error:', err)
      } finally {
        setIsSubmitting(false)
      }
    },
    [reviewMutation, userId, organizationId, item._id, showRejectInput, rejectionReason]
  )

  const isPending = localStatus === 'pending'
  const isExpired = localStatus === 'expired' || (isPending && item.expiresAt <= Date.now())

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-secondary p-4',
        'border-l-2 transition-all',
        RISK_STYLES[item.riskLevel],
        !isPending && 'opacity-70'
      )}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm text-white capitalize">{item.agentType}</span>
          <span className="text-text-muted text-sm">→</span>
          <span className="font-mono text-xs text-text-secondary">{item.action}</span>
          {item.target && (
            <span className="rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
              {item.target}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              RISK_BADGES[item.riskLevel]
            )}
          >
            {item.riskLevel}
          </span>
          {!isPending && (
            <span className={cn('text-xs font-medium capitalize', STATUS_STYLES[localStatus])}>
              {localStatus}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="mb-3 text-sm text-text-primary">{item.description}</p>

      {/* Context */}
      {item.context && (
        <div className="mb-3 rounded-lg border border-border bg-surface-tertiary px-3 py-2">
          <p className="text-xs text-text-secondary leading-relaxed">{item.context}</p>
        </div>
      )}

      {/* Rejection reason — for resolved items */}
      {item.rejectionReason && localStatus === 'rejected' && (
        <div className="mb-3 rounded-lg border border-status-error/20 bg-status-error/5 px-3 py-2">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">
            Rejection reason
          </p>
          <p className="text-xs text-text-secondary">{item.rejectionReason}</p>
        </div>
      )}

      {/* Expiry countdown */}
      <div className="mb-3 flex items-center gap-1 text-[11px] text-text-muted">
        <Clock className="h-3 w-3" />
        {isExpired ? (
          <span className="text-status-error">Expired</span>
        ) : isPending ? (
          <span>Expires in {countdown}</span>
        ) : (
          <span>
            {localStatus} {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : ''}
          </span>
        )}
      </div>

      {/* Actions */}
      {isPending && !isExpired && item.canReview && (
        <div className="space-y-2">
          {showRejectInput && (
            <div>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Rejection reason (optional)"
                className={cn(
                  'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm',
                  'text-text-primary placeholder:text-text-muted',
                  'focus:border-brand/50 focus:outline-none transition-colors'
                )}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleDecision('approve')}
              isLoading={isSubmitting && !showRejectInput}
              disabled={isSubmitting}
              leftIcon={<Check className="h-3.5 w-3.5" />}
              className="flex-1"
            >
              Approve
            </Button>
            {showRejectInput ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleDecision('reject')}
                  isLoading={isSubmitting}
                  disabled={isSubmitting}
                  leftIcon={<X className="h-3.5 w-3.5" />}
                  className="flex-1"
                >
                  Confirm Reject
                </Button>
                <button
                  type="button"
                  onClick={() => setShowRejectInput(false)}
                  className="rounded-lg p-2 text-text-muted hover:text-text-primary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleDecision('reject')}
                disabled={isSubmitting}
                leftIcon={<AlertTriangle className="h-3.5 w-3.5" />}
                className="flex-1"
              >
                Reject
              </Button>
            )}
          </div>
        </div>
      )}

      {isPending && !isExpired && !item.canReview && (
        <p className="text-center text-xs text-text-muted">
          Admin or owner permission required to review
        </p>
      )}
    </div>
  )
})
