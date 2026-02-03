'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ChevronDown } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Direct imports instead of barrel - bundle-barrel-imports optimization
import ChatInput from '@/components/chat/ChatInput'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { IconButton } from '@/components/ui/IconButton'
import { Logo } from '@/components/ui/Logo'
import { useHeader } from '@/contexts/HeaderContext'
import { UI } from '@/lib/constants'
import type { MessagePart } from '@/types'

// Dynamic import for MessageBubble - bundle-dynamic-imports optimization
// This component is heavy due to MarkdownRenderer and AI suggestions
const MessageBubble = dynamic(() => import('@/components/chat/MessageBubble'), {
  loading: () => <MessageBubbleSkeleton />,
  ssr: false,
})

// Lightweight skeleton for message loading
function MessageBubbleSkeleton() {
  return (
    <div className="flex w-full justify-start mb-6 animate-pulse">
      <div className="h-10 w-10 rounded-full bg-surface-muted mr-3" />
      <div className="flex flex-col max-w-[75%] gap-2">
        <div className="h-4 w-24 rounded bg-surface-muted" />
        <div className="h-20 w-64 rounded-2xl bg-surface-muted" />
      </div>
    </div>
  )
}

// Suggestion prompts - hoisted outside component (rendering-hoist-jsx)
const SUGGESTIONS = [
  'Add a new lead named John Smith',
  'Show me my schedule for today',
  'Create an invoice for $500',
  'List all my leads',
] as const

// Helper to extract text content from message parts - hoisted outside component (js-cache-function-results)
function extractTextFromParts(parts: Array<{ type?: string; text?: string }> | undefined): string {
  if (!parts) return ''
  return parts
    .map((part) => {
      if ('type' in part && part.type === 'text' && 'text' in part) return part.text
      return ''
    })
    .filter(Boolean)
    .join('')
}

export function ChatContainer() {
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const lastScrollTop = useRef(0)
  const isAutoScrolling = useRef(false)
  const { setIsHeaderVisible } = useHeader()

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
    onError: (error) => {
      console.error('Chat error:', error)
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // Check if user is near the bottom of the chat
  const checkIfNearBottom = useCallback(() => {
    if (!chatContainerRef.current) return true
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
    const threshold = UI.SCROLL_THRESHOLD
    return scrollHeight - scrollTop - clientHeight < threshold
  }, [])

  // Handle scroll events - controls header visibility based on scroll direction
  // Handle scroll events - controls header visibility based on scroll direction
  useEffect(() => {
    const container = chatContainerRef.current
    if (!container) return

    const handleScroll = () => {
      // Ignore programmatic scrolls
      if (isAutoScrolling.current) return

      const currentScrollTop = container.scrollTop
      const nearBottom = checkIfNearBottom()
      setIsNearBottom(nearBottom)
      setShowScrollButton(!nearBottom)

      // Header visibility logic
      // Always show header at the very top (handles bounce too)
      if (currentScrollTop <= 0) {
        setIsHeaderVisible(true)
      } else {
        const scrollDiff = currentScrollTop - lastScrollTop.current
        const SCROLL_THRESHOLD = 0 // Sensitive hiding for slow scrolls

        // Scrolling down significantly - hide header
        if (scrollDiff > SCROLL_THRESHOLD && currentScrollTop > 60) {
          setIsHeaderVisible(false)
        }
        // ANY upward scroll should show the header immediately
        else if (scrollDiff < 0) {
          setIsHeaderVisible(true)
        }
      }

      // Update last scroll position (clamp to 0)
      lastScrollTop.current = Math.max(0, currentScrollTop)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [checkIfNearBottom, setIsHeaderVisible])

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (isNearBottom) {
      isAutoScrolling.current = true
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      // Reset after animation
      setTimeout(() => {
        isAutoScrolling.current = false
        if (chatContainerRef.current) {
          lastScrollTop.current = chatContainerRef.current.scrollTop
        }
      }, 1000)
    }
  }, [isNearBottom])

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [])

  const handleSend = useCallback(
    (message: string) => {
      if (!message.trim()) return
      sendMessage({ text: message })
    },
    [sendMessage]
  )

  // Handle suggestion clicks
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      handleSend(suggestion)
    },
    [handleSend]
  )

  // Memoize the empty state UI
  const emptyStateUI = useMemo(
    () => (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-[#121212] to-[#1a1a1a] shadow-xl">
          <Logo size={48} />
        </div>
        <h2 className="mb-3 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text font-bold text-2xl text-transparent">
          Welcome to Reme
        </h2>
        <p className="mb-8 max-w-md text-gray-500">
          Your AI-powered business assistant. I can help you manage leads, schedule appointments,
          and create invoices through natural conversation.
        </p>
        <div className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              onClick={() => handleSend(suggestion)}
              className="rounded-xl border border-border bg-surface-tertiary px-4 py-3 text-left text-gray-400 text-sm transition-all duration-200 hover:border-amber-500/40 hover:bg-surface-elevated hover:text-amber-400"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    ),
    [handleSend]
  )

  // Memoize error UI
  const errorUI = useMemo(
    () =>
      error ? (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-400 text-sm">
          Error: {error.message}
        </div>
      ) : null,
    [error]
  )

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Messages area with mask gradient */}
      <div
        ref={chatContainerRef}
        className="custom-scrollbar flex-1 overflow-y-auto px-4 pt-6 md:px-0"
        style={{
          maskImage: 'linear-gradient(to bottom, black 95%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 95%, transparent 100%)',
        }}
      >
        <div className="mx-auto w-full max-w-4xl px-4 md:px-8">
          {messages.length === 0 ? (
            emptyStateUI
          ) : (
            <>
              {messages.map((message, index) => {
                // Extract content using hoisted helper (js-cache-function-results)
                const content = extractTextFromParts(message.parts)

                // Extract createdAt from metadata if available
                const createdAt =
                  message.metadata &&
                  typeof message.metadata === 'object' &&
                  'createdAt' in message.metadata
                    ? new Date(message.metadata.createdAt as number)
                    : new Date()

                // Find the previous user message for AI context
                let previousUserMessage: string | undefined
                if (message.role === 'assistant' && index > 0) {
                  for (let i = index - 1; i >= 0; i--) {
                    if (messages[i].role === 'user') {
                      previousUserMessage = extractTextFromParts(messages[i].parts)
                      break
                    }
                  }
                }

                return (
                  <MessageBubble
                    key={message.id}
                    message={{
                      id: message.id,
                      role: message.role as 'user' | 'assistant',
                      content,
                      parts: message.parts as MessagePart[] | undefined,
                      createdAt,
                    }}
                    previousUserMessage={previousUserMessage}
                    onSuggestionClick={handleSuggestionClick}
                  />
                )
              })}
              {isLoading && <TypingIndicator />}
              {errorUI}

              {/* Bottom padding for input area */}
              <div className="h-40" />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Bottom Gradient Overlay */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black via-black/80 to-transparent z-10" />

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <IconButton
          icon={<ChevronDown className="w-5 h-5" />}
          label="Scroll to bottom"
          onClick={scrollToBottom}
          variant="glass"
          className="absolute bottom-40 right-6 z-30"
        />
      )}

      {/* Input area - Floating Glass Effect */}
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-20 px-4">
        <div className="pointer-events-auto mx-auto w-full max-w-3xl">
          <ChatInput onSend={handleSend} disabled={false} isLoading={isLoading} />
        </div>
      </div>
    </div>
  )
}
