'use client'

import { Bell, CheckCheck, X } from 'lucide-react'
import type React from 'react'
import { memo, useState } from 'react'
import { Z_INDEX } from '@/lib/constants'

interface Notification {
  id: string
  title: string
  time: string
  read: boolean
}

interface NotificationDropdownProps {
  notifications: Notification[]
  onMarkAllRead: () => void
  onClose: () => void
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  notifications,
  onMarkAllRead,
  onClose,
}) => {
  const [isMarking, setIsMarking] = useState(false)

  const handleMarkRead = () => {
    setIsMarking(true)
    setTimeout(() => {
      onMarkAllRead()
      setIsMarking(false)
    }, 200)
  }

  return (
    <div
      className="absolute right-0 top-12 w-80 bg-surface-tertiary border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right"
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      <div className="px-4 py-3 border-b border-border-subtle flex justify-between items-center bg-surface-elevated">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
          {notifications.some((n) => !n.read) && (
            <span className="text-[10px] bg-brand/15 text-brand px-1.5 py-0.5 rounded border border-brand/20">
              {notifications.filter((n) => !n.read).length} New
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

      <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
        {notifications.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 bg-border-subtle rounded-full flex items-center justify-center mx-auto mb-2 text-text-disabled">
              <Bell className="w-[18px] h-[18px]" />
            </div>
            <p className="text-xs text-text-muted">No notifications</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {notifications.map((n, idx) => (
              <div
                key={n.id}
                className={`relative p-4 border-b border-border-subtle last:border-0 hover:bg-border-subtle transition-all duration-500 group cursor-pointer
                  ${!n.read ? 'bg-surface-elevated pl-4' : 'bg-transparent opacity-70 pl-6'}
                  animate-in slide-in-from-right-4 fade-in fill-mode-backwards
                `}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                {/* Unread Indicator Bar */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1 bg-brand-secondary transition-all duration-300 ${!n.read ? 'opacity-100' : 'opacity-0'}`}
                />

                <div className="flex justify-between items-start mb-1">
                  <span
                    className={`text-sm transition-all duration-300 ${!n.read ? 'text-text-primary font-semibold' : 'text-text-secondary font-medium'}`}
                  >
                    {n.title}
                  </span>
                  {!n.read && (
                    <span className="w-2 h-2 bg-brand rounded-full mt-1.5 shadow-[0_0_8px_var(--color-brand-muted)] animate-pulse" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`text-xs transition-colors ${!n.read ? 'text-text-secondary' : 'text-text-disabled'}`}
                  >
                    {n.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {notifications.some((n) => !n.read) && (
        <div className="p-2 border-t border-border-subtle bg-surface-elevated">
          <button
            type="button"
            onClick={handleMarkRead}
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

export default memo(NotificationDropdown)
