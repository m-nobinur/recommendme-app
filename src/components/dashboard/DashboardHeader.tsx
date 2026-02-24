'use client'

import { Bell } from 'lucide-react'
import { useState } from 'react'
import NotificationDropdown from '@/components/layout/NotificationDropdown'
import { Logo } from '@/components/ui/Logo'
import { useClickOutside } from '@/hooks'
import { Z_INDEX } from '@/lib/constants'
import type { Notification } from '@/types'

interface DashboardHeaderProps {
  isVisible: boolean
  notifications: Notification[]
  onMarkAllRead: () => void
}

export function DashboardHeader({ isVisible, notifications, onMarkAllRead }: DashboardHeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false)
  const notificationRef = useClickOutside<HTMLDivElement>(() => setShowNotifications(false))

  const hasUnread = notifications.some((n) => !n.read)

  return (
    <div className="group">
      {!isVisible && (
        <div
          className="fixed top-0 left-0 right-0 h-4"
          style={{ zIndex: Z_INDEX.SIDEBAR }}
          aria-hidden="true"
        />
      )}

      <header
        className={`absolute top-0 left-0 right-0 flex justify-between items-center px-8 shrink-0 border-b border-transparent hover:border-surface-elevated transition-all duration-300 ease-in-out ${
          isVisible
            ? 'h-16 opacity-100 py-4 translate-y-0 pointer-events-auto'
            : 'h-16 opacity-0 py-4 -translate-y-full pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto'
        }`}
        style={{ zIndex: Z_INDEX.HEADER }}
      >
        {/* Left: Brand */}
        <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity select-none cursor-default">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center border border-border logo-container shadow-lg shadow-black/40">
            <Logo size={18} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary tracking-wide">RecommendMe</h1>
          </div>
        </div>

        {/* Right: Notification Bell */}
        <div className="flex items-center gap-3 relative" ref={notificationRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-300 ${
                showNotifications
                  ? 'bg-surface-muted text-white'
                  : 'text-text-muted hover:text-brand hover:bg-surface-elevated'
              }`}
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {hasUnread && (
                <span className="absolute top-2 right-2.5 w-1.5 h-1.5 bg-brand rounded-full shadow-[0_0_8px_var(--color-brand-muted)]" />
              )}
            </button>
            {showNotifications && (
              <NotificationDropdown
                notifications={notifications}
                onMarkAllRead={onMarkAllRead}
                onClose={() => setShowNotifications(false)}
              />
            )}
          </div>
        </div>
      </header>
    </div>
  )
}
