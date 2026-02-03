'use client'

import { Bell, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import NotificationDropdown from '@/components/layout/NotificationDropdown'
import { Logo } from '@/components/ui/Logo'
import { useClickOutside } from '@/hooks'
import type { Notification } from '@/types'

interface DashboardHeaderProps {
  isVisible: boolean
  isOnChat: boolean
  notifications: Notification[]
  onMarkAllRead: () => void
}

export function DashboardHeader({
  isVisible,
  isOnChat,
  notifications,
  onMarkAllRead,
}: DashboardHeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false)
  const notificationRef = useClickOutside<HTMLDivElement>(() => setShowNotifications(false))

  const hasUnread = notifications.some((n) => !n.read)

  return (
    <header
      className={`absolute top-0 left-0 right-0 flex justify-between items-center px-8 z-30 shrink-0 border-b border-transparent hover:border-[#111] transition-all duration-300 ease-in-out ${
        isVisible
          ? 'h-16 opacity-100 py-4 translate-y-0 pointer-events-auto'
          : 'h-16 opacity-0 py-4 -translate-y-full pointer-events-none'
      }`}
    >
      {/* Left: Brand */}
      <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity select-none cursor-default">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#121212] to-surface-muted border border-border flex items-center justify-center shadow-lg shadow-black/40">
          <Logo size={18} />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-100 tracking-wide">RecommendMe</h1>
        </div>
      </div>

      {/* Right: Chat Link + Notification Bell */}
      <div className="flex items-center gap-3 relative" ref={notificationRef}>
        {/* Chat with Reme Link - only show when not on chat page */}
        {!isOnChat && (
          <Link
            href="/chat"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-amber-500 hover:bg-surface-elevated transition-all duration-200"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Chat with Reme</span>
          </Link>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-300 ${
              showNotifications
                ? 'bg-surface-muted text-white'
                : 'text-gray-500 hover:text-amber-500 hover:bg-surface-elevated'
            }`}
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            {hasUnread && (
              <span className="absolute top-2 right-2.5 w-1.5 h-1.5 bg-amber-500 rounded-full shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
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
  )
}
