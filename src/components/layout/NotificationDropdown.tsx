'use client'

import type { Id } from '@convex/_generated/dataModel'
import {
  AlertTriangle,
  Bell,
  Bot,
  Brain,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Info,
  Mail,
  Shield,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type React from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { Z_INDEX } from '@/lib/constants'
import { cn } from '@/lib/utils/cn'
import type { Notification, NotificationCategory, NotificationSeverity } from '@/types'

interface NotificationDropdownProps {
  notifications: Notification[]
  onMarkRead: (id: Id<'notifications'>) => void
  onMarkAllRead: () => void
  onDismiss: (id: Id<'notifications'>) => void
  onClose: () => void
}

const CATEGORY_CONFIG: Record<
  NotificationCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  approval: { label: 'Approvals', icon: Shield, color: 'text-amber-400' },
  agent: { label: 'Agents', icon: Bot, color: 'text-violet-400' },
  crm: { label: 'CRM', icon: Sparkles, color: 'text-blue-400' },
  memory: { label: 'Memory', icon: Brain, color: 'text-emerald-400' },
  budget: { label: 'Budget', icon: CircleDollarSign, color: 'text-orange-400' },
  communication: { label: 'Comms', icon: Mail, color: 'text-cyan-400' },
  system: { label: 'System', icon: Info, color: 'text-gray-400' },
}

const SEVERITY_ICON: Record<NotificationSeverity, React.ElementType> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: 'text-blue-400',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
}

const SEVERITY_BG: Record<NotificationSeverity, string> = {
  info: 'bg-blue-500/10',
  success: 'bg-emerald-500/10',
  warning: 'bg-amber-500/10',
  error: 'bg-red-500/10',
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function isToday(timestamp: number): boolean {
  const now = new Date()
  const date = new Date(timestamp)
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  )
}

type FilterTab = 'all' | NotificationCategory

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [isMarking, setIsMarking] = useState(false)

  const filtered = useMemo(() => {
    if (activeTab === 'all') return notifications
    return notifications.filter((n) => n.category === activeTab)
  }, [notifications, activeTab])

  const { today, earlier } = useMemo(() => {
    const todayList: Notification[] = []
    const earlierList: Notification[] = []
    for (const n of filtered) {
      if (isToday(n.createdAt)) {
        todayList.push(n)
      } else {
        earlierList.push(n)
      }
    }
    return { today: todayList, earlier: earlierList }
  }, [filtered])

  const availableCategories = useMemo(() => {
    const cats = new Set<NotificationCategory>()
    for (const n of notifications) {
      cats.add(n.category)
    }
    return cats
  }, [notifications])

  const hasUnread = notifications.some((n) => !n.isRead)

  const handleMarkAllRead = useCallback(() => {
    setIsMarking(true)
    onMarkAllRead()
    setTimeout(() => setIsMarking(false), 300)
  }, [onMarkAllRead])

  const handleNotificationClick = useCallback(
    (n: Notification) => {
      if (!n.isRead) {
        onMarkRead(n._id as Id<'notifications'>)
      }
    },
    [onMarkRead]
  )

  return (
    <div
      className="absolute right-0 top-12 w-96 bg-surface-tertiary border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right"
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle flex justify-between items-center bg-surface-elevated">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
          {hasUnread && (
            <span className="text-[10px] bg-brand/15 text-brand px-1.5 py-0.5 rounded border border-brand/20">
              {notifications.filter((n) => !n.isRead).length} New
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Category Filter Tabs */}
      {notifications.length > 0 && (
        <div className="px-3 py-2 border-b border-border-subtle flex gap-1 overflow-x-auto custom-scrollbar bg-surface-secondary/50">
          <FilterPill
            label="All"
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
          />
          {(Object.keys(CATEGORY_CONFIG) as NotificationCategory[])
            .filter((cat) => availableCategories.has(cat))
            .map((cat) => (
              <FilterPill
                key={cat}
                label={CATEGORY_CONFIG[cat].label}
                active={activeTab === cat}
                onClick={() => setActiveTab(cat)}
                icon={CATEGORY_CONFIG[cat].icon}
                iconColor={CATEGORY_CONFIG[cat].color}
              />
            ))}
        </div>
      )}

      {/* Notification List */}
      <div className="max-h-[380px] overflow-y-auto custom-scrollbar">
        {filtered.length === 0 ? (
          <EmptyState activeTab={activeTab} />
        ) : (
          <>
            {today.length > 0 && (
              <NotificationGroup
                label="Today"
                notifications={today}
                onClick={handleNotificationClick}
                onDismiss={onDismiss}
              />
            )}
            {earlier.length > 0 && (
              <NotificationGroup
                label="Earlier"
                notifications={earlier}
                onClick={handleNotificationClick}
                onDismiss={onDismiss}
              />
            )}
          </>
        )}
      </div>

      {/* Footer: Mark all read */}
      {hasUnread && (
        <div className="p-2 border-t border-border-subtle bg-surface-elevated">
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={isMarking}
            className="w-full text-center text-xs font-medium text-brand-secondary/80 hover:text-brand hover:bg-surface-muted py-2 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {isMarking ? (
              <span className="w-3 h-3 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
            ) : (
              <CheckCheck className="w-3.5 h-3.5" />
            )}
            Mark all as read
          </button>
        </div>
      )}
    </div>
  )
}

function FilterPill({
  label,
  active,
  onClick,
  icon: Icon,
  iconColor,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon?: React.ElementType
  iconColor?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-[11px] font-medium rounded-md transition-all whitespace-nowrap flex items-center gap-1',
        active
          ? 'bg-surface-muted text-text-primary border border-border'
          : 'text-text-muted hover:text-text-secondary hover:bg-surface-elevated border border-transparent'
      )}
    >
      {Icon && <Icon className={cn('w-3 h-3', active ? iconColor : 'text-text-disabled')} />}
      {label}
    </button>
  )
}

function NotificationGroup({
  label,
  notifications,
  onClick,
  onDismiss,
}: {
  label: string
  notifications: Notification[]
  onClick: (n: Notification) => void
  onDismiss: (id: Id<'notifications'>) => void
}) {
  return (
    <div>
      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-disabled bg-surface-primary/50">
        {label}
      </div>
      {notifications.map((n, idx) => (
        <NotificationItem
          key={n._id}
          notification={n}
          index={idx}
          onClick={() => onClick(n)}
          onDismiss={() => onDismiss(n._id as Id<'notifications'>)}
        />
      ))}
    </div>
  )
}

function NotificationItem({
  notification: n,
  index,
  onClick,
  onDismiss,
}: {
  notification: Notification
  index: number
  onClick: () => void
  onDismiss: () => void
}) {
  const SeverityIcon = SEVERITY_ICON[n.severity]
  const catConfig = CATEGORY_CONFIG[n.category]

  const content = (
    <button
      type="button"
      className={cn(
        'relative w-full text-left px-4 py-3 border-b border-border-subtle last:border-0 hover:bg-border-subtle/50 transition-all duration-150 group cursor-pointer',
        !n.isRead ? 'bg-surface-elevated' : 'bg-transparent opacity-75',
        'animate-in slide-in-from-right-4 fade-in fill-mode-backwards'
      )}
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={onClick}
    >
      {/* Unread indicator */}
      {!n.isRead && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-brand transition-all duration-300" />
      )}

      <div className="flex gap-3">
        {/* Icon */}
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
            SEVERITY_BG[n.severity]
          )}
        >
          <SeverityIcon className={cn('w-4 h-4', SEVERITY_COLOR[n.severity])} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                'text-sm leading-tight',
                !n.isRead ? 'text-text-primary font-medium' : 'text-text-secondary'
              )}
            >
              {n.title}
            </span>

            {/* Dismiss button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDismiss()
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-text-disabled hover:text-text-muted p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {n.body && <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{n.body}</p>}

          <div className="flex items-center gap-2 mt-1.5">
            <span className={cn('text-[10px] flex items-center gap-1', catConfig.color)}>
              <catConfig.icon className="w-2.5 h-2.5" />
              {catConfig.label}
            </span>
            <span className="text-[10px] text-text-disabled">
              {formatRelativeTime(n.createdAt)}
            </span>

            {n.actionUrl && n.actionLabel && (
              <span className="text-[10px] text-brand flex items-center gap-0.5 ml-auto">
                {n.actionLabel}
                <ChevronRight className="w-2.5 h-2.5" />
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )

  if (n.actionUrl) {
    return (
      <Link href={n.actionUrl as Route} onClick={onClick}>
        {content}
      </Link>
    )
  }

  return content
}

function EmptyState({ activeTab }: { activeTab: FilterTab }) {
  return (
    <div className="p-8 text-center">
      <div className="w-10 h-10 bg-border-subtle rounded-full flex items-center justify-center mx-auto mb-2 text-text-disabled">
        <Bell className="w-[18px] h-[18px]" />
      </div>
      <p className="text-xs text-text-muted">
        {activeTab === 'all'
          ? 'No notifications'
          : `No ${CATEGORY_CONFIG[activeTab].label.toLowerCase()} notifications`}
      </p>
    </div>
  )
}

export default memo(NotificationDropdown)
