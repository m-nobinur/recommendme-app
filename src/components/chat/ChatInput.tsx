'use client'

import { Calendar, Database, FileText, Send, Users, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Direct imports instead of barrel (bundle-barrel-imports)
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'

// Dynamic import for BrainSwitcher - heavy component with dropdown (bundle-dynamic-imports)
const BrainSwitcher = dynamic(() => import('@/components/layout/BrainSwitcher'), {
  loading: () => <BrainSwitcherSkeleton />,
  ssr: false,
})

// Lightweight skeleton for brain switcher
function BrainSwitcherSkeleton() {
  return <div className="h-7 w-24 animate-pulse rounded-lg bg-surface-muted" />
}

interface Props {
  onSend: (message: string) => void
  disabled: boolean
  isLoading?: boolean
}

// Shortcuts config hoisted outside component (rendering-hoist-jsx)
const SHORTCUTS = [
  { label: 'CRM', icon: 'db' },
  { label: 'Invoice', icon: 'file' },
  { label: 'Calendar', icon: 'cal' },
  { label: 'Contacts', icon: 'user' },
] as const

type ShortcutIcon = (typeof SHORTCUTS)[number]['icon']

// Icon map for efficient lookup (js-set-map-lookups)
const ICON_COMPONENTS: Record<ShortcutIcon, React.FC<{ className: string }>> = {
  db: Database,
  file: FileText,
  cal: Calendar,
  user: Users,
}

// Memoized shortcut icon component (rerender-memo)
const ShortcutIcon = memo(function ShortcutIcon({
  icon,
  className,
}: {
  icon: ShortcutIcon
  className: string
}) {
  const IconComponent = ICON_COMPONENTS[icon]
  return <IconComponent className={className} />
})

const ChatInput: React.FC<Props> = ({ onSend, disabled, isLoading }) => {
  const [text, setText] = useState('')
  const [activeShortcut, setActiveShortcut] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    if (disabled || isLoading) return

    const messageContent = text.trim()
    if (!(messageContent || activeShortcut)) return

    // Combine shortcut with text if present
    const finalMessage = activeShortcut
      ? `Show me ${activeShortcut.toLowerCase()} ${messageContent}`.trim()
      : messageContent

    onSend(finalMessage)
    setText('')
    setActiveShortcut(null)

    // Keep focus on the input after sending
    // Use setTimeout to ensure focus happens after React state updates
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }, [text, disabled, isLoading, onSend, activeShortcut])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  // Auto-resize textarea using callback in onChange (no effect needed)
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target
    setText(textarea.value)
    // Auto-resize: reset height, then set to scrollHeight (capped at 120px)
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }, [])

  // Track previous loading state to detect when response completes
  const prevIsLoading = useRef(isLoading)

  // Refocus input when loading completes (AI response finished)
  useEffect(() => {
    // When loading transitions from true to false, refocus the input
    if (prevIsLoading.current && !isLoading && !disabled) {
      // Small delay to ensure UI has settled
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    }
    prevIsLoading.current = isLoading
  }, [isLoading, disabled])

  // Initial focus on mount
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus()
    }
  }, [disabled])

  // Find active shortcut data efficiently (js-index-maps)
  const activeShortcutData = useMemo(
    () => SHORTCUTS.find((s) => s.label === activeShortcut),
    [activeShortcut]
  )

  return (
    <div className="group relative rounded-2xl border border-white/10 bg-black/40 p-3 shadow-sm backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-black/50 focus-within:border-amber-500/30 focus-within:bg-black/60 focus-within:ring-1 focus-within:ring-amber-500/20 focus-within:hover:border-amber-500/40">
      {/* Context Pill Area */}
      {activeShortcut && activeShortcutData && (
        <div className="px-1 pb-2">
          <div className="fade-in slide-in-from-bottom-1 inline-flex animate-in items-center gap-1.5 rounded-full border border-amber-500/10 bg-amber-500/5 px-2 py-0.5 font-medium text-[11px] text-amber-500/90 duration-200">
            <ShortcutIcon icon={activeShortcutData.icon} className="h-3 w-3" />
            <span className="text-[10px] opacity-70">Using {activeShortcut}</span>
            <button
              type="button"
              onClick={() => setActiveShortcut(null)}
              className="ml-0.5 rounded-full p-0.5 text-amber-500/50 transition-colors hover:bg-amber-500/10 hover:text-amber-500"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        placeholder={
          activeShortcut ? `Ask about ${activeShortcut.toLowerCase()}...` : 'Type your message...'
        }
        disabled={disabled || isLoading}
        className="max-h-[120px] min-h-[40px] w-full resize-none bg-transparent text-[15px] text-gray-200 leading-relaxed placeholder-gray-600 focus:outline-none"
        rows={1}
      />

      <div className="mt-2 flex items-center justify-between border-white/5 border-t pt-2">
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
          {/* Brain Switcher - First Item */}
          <BrainSwitcher />

          {/* Divider */}
          <div className="mx-1 h-5 w-px bg-gray-800" />

          {SHORTCUTS.map((s) => {
            const isActive = activeShortcut === s.label
            return (
              <Button
                key={s.label}
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (isActive) {
                    setActiveShortcut(null)
                  } else {
                    setActiveShortcut(s.label)
                  }
                }}
                className={`h-7 border font-medium text-xs transition-all duration-200 ${
                  isActive
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                    : 'border-transparent bg-transparent text-gray-400 hover:border-gray-800 hover:text-gray-200'
                }`}
              >
                <span className={`mr-1.5 ${isActive ? 'text-amber-500' : 'text-amber-600/70'}`}>
                  <ShortcutIcon icon={s.icon} className="h-3.5 w-3.5" />
                </span>
                {s.label}
              </Button>
            )
          })}
        </div>

        <IconButton
          onClick={handleSubmit}
          disabled={!(text.trim() || activeShortcut) || disabled || isLoading}
          variant="primary"
          size="sm"
          label="Send message"
          icon={<Send className="h-4 w-4" />}
          className={
            !(text.trim() || activeShortcut) || disabled || isLoading
              ? 'cursor-not-allowed bg-surface-muted text-gray-600 opacity-50 hover:bg-surface-muted'
              : ''
          }
        />
      </div>
    </div>
  )
}

export default memo(ChatInput)
