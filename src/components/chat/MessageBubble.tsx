'use client'

import dynamic from 'next/dynamic'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { generateSuggestions } from '@/app/actions/suggestions'
// Direct import instead of barrel for Logo (bundle-barrel-imports)
import { Logo } from '@/components/ui/Logo'
import { TIMING } from '@/lib/constants'
import type { ChatMessage } from '@/types'

// Dynamic import for MarkdownRenderer - heavy component with remark/rehype (bundle-dynamic-imports)
const MarkdownRenderer = dynamic(() => import('./MarkdownRenderer'), {
  loading: () => <MarkdownSkeleton />,
  ssr: false,
})

// Lightweight skeleton for markdown loading
function MarkdownSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 w-full rounded bg-surface-muted" />
      <div className="h-4 w-3/4 rounded bg-surface-muted" />
    </div>
  )
}

interface Props {
  message: ChatMessage
  previousUserMessage?: string
  onSuggestionClick?: (suggestion: string) => void
}

// Skeleton data hoisted outside component (rendering-hoist-jsx)
const SKELETON_WIDTHS = [{ width: 'w-28' }, { width: 'w-36' }, { width: 'w-24' }] as const

// Shimmer skeleton for suggestions - matches actual button height to prevent layout shift
const SuggestionSkeleton = memo(function SuggestionSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden h-8">
      {SKELETON_WIDTHS.map((item, i) => (
        <div
          key={i}
          className={`relative ${item.width} h-[30px] rounded-full overflow-hidden border border-surface-muted shrink-0`}
        >
          <div className="absolute inset-0 bg-surface-tertiary" />
          <div
            className="absolute inset-0 shimmer-skeleton"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        </div>
      ))}
    </div>
  )
})

// Time format options hoisted outside component (rendering-hoist-jsx)
const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
}

function MessageBubbleComponent({ message, previousUserMessage, onSuggestionClick }: Props) {
  const isAi = message.role === 'assistant'
  const timestamp = message.createdAt || new Date()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(message.suggestions || [])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const hasGeneratedRef = useRef(false)

  // Extract content from parts array or fall back to content string (rerender-memo optimization)
  const content = useMemo(() => {
    if (message.parts && message.parts.length > 0) {
      return message.parts
        .map((part) => {
          switch (part.type) {
            case 'text':
              return part.text || ''
            case 'reasoning':
              return part.reasoning || ''
            case 'tool-invocation':
              return `[Tool: ${part.toolInvocation?.toolName}]`
            default:
              return ''
          }
        })
        .filter(Boolean)
        .join('\n\n')
    }
    return message.content || ''
  }, [message.parts, message.content])

  // Format timestamp once (rerender-lazy-state-init)
  const formattedTime = useMemo(
    () => timestamp.toLocaleTimeString([], TIME_FORMAT_OPTIONS),
    [timestamp]
  )

  // Generate AI-powered suggestions after AI message is shown
  useEffect(() => {
    // Skip if already generated or not an AI message or no content
    if (hasGeneratedRef.current || !isAi || !content || message.suggestions?.length) {
      if (message.suggestions?.length) {
        setSuggestions(message.suggestions)
        setShowSuggestions(true)
      }
      return
    }

    // Mark as generating to prevent duplicate calls
    hasGeneratedRef.current = true
    setIsLoadingSuggestions(true)

    // Call the server action to generate suggestions
    const userQuery = previousUserMessage || 'Hello'

    generateSuggestions(userQuery, content)
      .then((generatedSuggestions) => {
        if (generatedSuggestions.length > 0) {
          setSuggestions(generatedSuggestions)
        }
        setIsLoadingSuggestions(false)
        // Small delay before showing to ensure smooth transition
        setTimeout(() => {
          setShowSuggestions(true)
        }, TIMING.SUGGESTION_SHOW_DELAY)
      })
      .catch((error) => {
        console.error('Failed to generate suggestions:', error)
        setIsLoadingSuggestions(false)
      })
  }, [isAi, content, previousUserMessage, message.suggestions])

  return (
    <div
      className={`flex w-full ${isAi ? 'justify-start' : 'justify-end'} fade-in slide-in-from-bottom-2 group mb-6 animate-in duration-300`}
    >
      {isAi && (
        <div className="mt-1 mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-linear-to-tr from-[#121212] to-surface-muted shadow-black/40 shadow-lg">
          <Logo size={20} />
        </div>
      )}

      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        {isAi && (
          <div className="mb-2 ml-1 flex items-center gap-2">
            <span className="bg-linear-to-r from-amber-400 to-orange-500 bg-clip-text font-semibold text-transparent text-xs tracking-wide">
              REME
            </span>
            <span className="h-1 w-1 rounded-full bg-gray-600" />
            <span className="font-medium text-[11px] text-gray-500">{formattedTime}</span>
          </div>
        )}

        <div
          className={`relative overflow-hidden rounded-2xl text-[15px] leading-relaxed ${
            isAi
              ? 'rounded-tl-none border border-surface-muted bg-linear-to-br from-[#111] to-surface-tertiary text-gray-200 shadow-black/20 shadow-xl'
              : 'rounded-tr-none border border-[#252525] bg-linear-to-br from-surface-muted to-[#111] text-gray-100'
          }`}
        >
          {/* Subtle glow effect for AI messages */}
          {isAi && (
            <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-amber-500/2 to-transparent" />
          )}

          <div className={`relative ${isAi ? 'px-5 py-4' : 'px-5 py-3.5'}`}>
            {isAi ? (
              <MarkdownRenderer content={content} />
            ) : (
              <p className="text-gray-100">{content}</p>
            )}
          </div>
        </div>

        {/* Follow-up Suggestions with smooth crossfade */}
        {isAi && (
          <div className="mt-3 min-h-[36px] relative">
            {/* Skeleton - fades out */}
            <div
              className={`flex gap-2 overflow-hidden ml-1 transition-opacity duration-300 ${
                isLoadingSuggestions
                  ? 'opacity-100'
                  : 'opacity-0 absolute inset-0 pointer-events-none'
              }`}
            >
              <SuggestionSkeleton />
            </div>

            {/* Actual suggestions - fades in */}
            <div
              className={`flex gap-2 overflow-x-auto no-scrollbar py-1 px-1 -mx-1 max-w-[calc(100%+8px)] transition-opacity duration-300 ${
                !isLoadingSuggestions && showSuggestions && suggestions.length > 0
                  ? 'opacity-100'
                  : 'opacity-0 absolute inset-0 pointer-events-none'
              }`}
            >
              {suggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion}-${idx}`}
                  type="button"
                  onClick={() => onSuggestionClick?.(suggestion)}
                  className="h-[30px] px-3 py-1.5 text-xs text-gray-400 bg-surface-tertiary border border-border rounded-full 
                           hover:text-amber-400 hover:border-amber-500/40 hover:bg-surface-elevated 
                           transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0
                           focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-1 focus:ring-offset-black"
                  style={{
                    animation: showSuggestions
                      ? `fadeSlideUp 0.3s ease-out ${idx * 50}ms backwards`
                      : 'none',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isAi && (
          <div className="mt-1.5 mr-1 flex items-center justify-end gap-2">
            <span className="font-medium text-[11px] text-gray-500">{formattedTime}</span>
            <span className="text-[10px] text-emerald-500/70">✓✓</span>
          </div>
        )}
      </div>
    </div>
  )
}

const MessageBubble = memo(MessageBubbleComponent)
export default MessageBubble
