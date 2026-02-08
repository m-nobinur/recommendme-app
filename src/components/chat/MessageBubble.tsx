'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { generateSuggestions } from '@/app/actions/suggestions'
import { Logo } from '@/components/ui/Logo'
import { TIMING } from '@/lib/constants'
import type { ChatMessage } from '@/types'
import MarkdownRenderer from './MarkdownRenderer'

const EMPTY_ARRAY: string[] = []

const SKELETON_WIDTHS = [{ width: 'w-28' }, { width: 'w-36' }, { width: 'w-24' }] as const

const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
}

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

interface Props {
  message: ChatMessage
  previousUserMessage?: string
  onSuggestionClick?: (suggestion: string) => void
  isLastAssistantMessage?: boolean
  animate?: boolean
}

function MessageBubbleComponent({
  message,
  previousUserMessage,
  onSuggestionClick,
  isLastAssistantMessage = false,
  animate = true,
}: Props) {
  const isAi = message.role === 'assistant'
  const timestamp = message.createdAt || new Date()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(message.suggestions || EMPTY_ARRAY)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const hasGeneratedRef = useRef(false)

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

  const formattedTime = useMemo(
    () => timestamp.toLocaleTimeString([], TIME_FORMAT_OPTIONS),
    [timestamp]
  )

  // Suggestion generation effect
  useEffect(() => {
    if (message.suggestions?.length) {
      setSuggestions(message.suggestions)
      setShowSuggestions(true)
      return
    }

    if (hasGeneratedRef.current || !isAi || !content || !isLastAssistantMessage) {
      return
    }

    hasGeneratedRef.current = true
    setIsLoadingSuggestions(true)

    const userQuery = previousUserMessage || 'Hello'

    generateSuggestions(userQuery, content)
      .then((generated) => {
        if (generated.length > 0) {
          setSuggestions(generated)
        }
        setIsLoadingSuggestions(false)
        setTimeout(() => setShowSuggestions(true), TIMING.SUGGESTION_SHOW_DELAY)
      })
      .catch((error) => {
        console.error('Failed to generate suggestions:', error)
        setIsLoadingSuggestions(false)
      })
  }, [isAi, content, previousUserMessage, message.suggestions, isLastAssistantMessage])

  return (
    <div
      className={`flex w-full ${isAi ? 'justify-start' : 'justify-end'} group mb-6 ${animate ? 'fade-in slide-in-from-bottom-2 animate-in duration-300' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 120px' }}
    >
      {isAi && (
        <div className="mt-1 mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-linear-to-tr from-[#121212] to-surface-muted shadow-black/40 shadow-lg">
          <Logo size={20} />
        </div>
      )}

      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        {/* AI label + timestamp */}
        {isAi && (
          <div className="mb-2 ml-1 flex items-center gap-2">
            <span className="bg-linear-to-r from-amber-400 to-orange-500 bg-clip-text font-semibold text-transparent text-xs tracking-wide">
              REME
            </span>
            <span className="h-1 w-1 rounded-full bg-gray-600" />
            <span className="font-medium text-[11px] text-gray-500">{formattedTime}</span>
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`relative overflow-hidden rounded-2xl text-[15px] leading-relaxed ${
            isAi
              ? 'rounded-tl-none border border-surface-muted bg-linear-to-br from-[#111] to-surface-tertiary text-gray-200 shadow-black/20 shadow-xl'
              : 'rounded-tr-none border border-[#252525] bg-linear-to-br from-surface-muted to-[#111] text-gray-100'
          }`}
        >
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

        {/* Follow-up suggestions */}
        {isAi && (isLastAssistantMessage || suggestions.length > 0) && (
          <SuggestionsArea
            suggestions={suggestions}
            isLoading={isLoadingSuggestions}
            showSuggestions={showSuggestions}
            onSuggestionClick={onSuggestionClick}
          />
        )}

        {/* User message timestamp */}
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

interface SuggestionsAreaProps {
  suggestions: string[]
  isLoading: boolean
  showSuggestions: boolean
  onSuggestionClick?: (suggestion: string) => void
}

const SuggestionsArea = memo(function SuggestionsArea({
  suggestions,
  isLoading,
  showSuggestions,
  onSuggestionClick,
}: SuggestionsAreaProps) {
  return (
    <div className="mt-3 min-h-[36px] relative">
      <div
        className={`flex gap-2 overflow-hidden ml-1 transition-opacity duration-300 ${
          isLoading ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'
        }`}
      >
        <SuggestionSkeleton />
      </div>

      {/* Actual suggestions */}
      <div
        className={`flex gap-2 overflow-x-auto no-scrollbar py-1 px-1 -mx-1 max-w-[calc(100%+8px)] transition-opacity duration-300 ${
          !isLoading && showSuggestions && suggestions.length > 0
            ? 'opacity-100'
            : 'opacity-0 absolute inset-0 pointer-events-none'
        }`}
      >
        {suggestions.map((suggestion, idx) => (
          <button
            key={`${suggestion}-${idx}`}
            type="button"
            onClick={() => onSuggestionClick?.(suggestion)}
            className="h-[30px] px-3 py-1.5 text-xs text-gray-400 bg-surface-tertiary border border-border rounded-full hover:text-amber-400 hover:border-amber-500/40 hover:bg-surface-elevated transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-1 focus:ring-offset-black"
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
  )
})

const MessageBubble = memo(MessageBubbleComponent)
export default MessageBubble
