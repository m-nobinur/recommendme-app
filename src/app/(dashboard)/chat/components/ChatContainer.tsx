'use client'

import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { DefaultChatTransport } from 'ai'
import { ChevronDown } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatInput from '@/components/chat/ChatInput'
import MessageBubble from '@/components/chat/MessageBubble'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { IconButton } from '@/components/ui/IconButton'
import { Logo } from '@/components/ui/Logo'
import { useHeader } from '@/contexts/HeaderContext'
import { API, UI, Z_INDEX } from '@/lib/constants'
import { useChatStore, useModelStore } from '@/stores'
import type { FeedbackRating, MessagePart } from '@/types'
import { ChatHistorySkeleton } from './ChatSkeleton'

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

const SUGGESTIONS = [
  'Add a new lead named John Smith',
  'Show me my schedule for today',
  'Create an invoice for $500',
  'List all my leads',
] as const

const InlineUserMessage = memo(function InlineUserMessage({
  content,
  createdAt,
  animate = true,
}: {
  content: string
  createdAt: Date
  animate?: boolean
}) {
  const formattedTime = createdAt.toLocaleTimeString([], TIME_FORMAT)
  return (
    <div
      className={`flex w-full justify-end group mb-6 ${animate ? 'fade-in slide-in-from-bottom-2 animate-in duration-300' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
    >
      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        <div className="relative overflow-hidden rounded-2xl rounded-tr-none border border-border bubble-user text-[15px] leading-relaxed text-text-primary">
          <div className="relative px-5 py-3.5">
            <p className="text-text-primary">{content}</p>
          </div>
        </div>
        <div className="mt-1.5 mr-1 flex items-center justify-end gap-2">
          <span className="font-medium text-[11px] text-text-muted">{formattedTime}</span>
          <span className="text-[10px] text-status-success/70">✓✓</span>
        </div>
      </div>
    </div>
  )
})

const EmptyState = memo(function EmptyState({ onSend }: { onSend: (message: string) => void }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center animate-in fade-in duration-500">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-border logo-container shadow-xl">
        <Logo size={48} />
      </div>
      <h2 className="mb-3 text-gradient-brand font-bold text-2xl">Welcome to Reme</h2>
      <p className="mb-8 max-w-md text-text-muted">
        Your AI-powered business assistant. I can help you manage leads, schedule appointments, and
        create invoices through natural conversation.
      </p>
      <div className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            onClick={() => onSend(suggestion)}
            className="rounded-xl border border-border bg-surface-tertiary px-4 py-3 text-left text-text-secondary text-sm brand-hover"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
})

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

type ViewState = 'hydrating' | 'loading_history' | 'ready'

export function ChatContainer() {
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const lastScrollTop = useRef(0)
  const isAutoScrolling = useRef(false)
  const { setIsHeaderVisible } = useHeader()

  const providerRef = useRef(useModelStore.getState().provider)
  const brainTierRef = useRef(useModelStore.getState().brainTier)

  useEffect(() => {
    return useModelStore.subscribe((s) => {
      providerRef.current = s.provider
      brainTierRef.current = s.brainTier
    })
  }, [])

  const hasHydrated = useChatStore((s) => s.hasHydrated)
  const getOrCreateConversationId = useChatStore((s) => s.getOrCreateConversationId)
  const storeConversationId = useChatStore((s) => s.conversationId)

  const [viewState, setViewState] = useState<ViewState>('hydrating')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (!hasHydrated || initRef.current) return
    initRef.current = true

    const restoredId = storeConversationId
    if (restoredId) {
      setActiveConversationId(restoredId)
      setViewState('loading_history')
    } else {
      const freshId = getOrCreateConversationId()
      setActiveConversationId(freshId)
      setViewState('ready')
    }
  }, [hasHydrated, storeConversationId, getOrCreateConversationId])

  const userScrolledAway = useRef(false)
  const prevStatusRef = useRef<string>('')

  const chatTransport = useMemo(
    () =>
      activeConversationId
        ? new DefaultChatTransport({
            api: API.CHAT_ENDPOINT,
            body: () => ({
              provider: providerRef.current,
              tier: brainTierRef.current,
              conversationId: activeConversationId,
            }),
          })
        : undefined,
    [activeConversationId]
  )

  const sendingRef = useRef(false)

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport: chatTransport,
    onError: (err) => {
      sendingRef.current = false
      console.error('Chat error:', err)
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'
  const showTypingIndicator = status === 'submitted'

  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackRating>>({})
  const feedbackMapRef = useRef<Record<string, FeedbackRating>>({})
  const feedbackInFlightRef = useRef<Set<string>>(new Set())

  const updateFeedbackMap = useCallback((next: Record<string, FeedbackRating>) => {
    feedbackMapRef.current = next
    setFeedbackMap(next)
  }, [])

  const handleFeedback = useCallback(
    async (messageId: string, rating: FeedbackRating) => {
      if (!activeConversationId) {
        return
      }

      if (feedbackInFlightRef.current.has(messageId)) {
        return
      }

      if (feedbackMapRef.current[messageId]) {
        return
      }

      feedbackInFlightRef.current.add(messageId)

      const nextMap = {
        ...feedbackMapRef.current,
        [messageId]: rating,
      }
      updateFeedbackMap(nextMap)

      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            conversationId: activeConversationId,
            rating,
          }),
        })
        if (!res.ok) {
          const rollbackMap = { ...feedbackMapRef.current }
          delete rollbackMap[messageId]
          updateFeedbackMap(rollbackMap)
        }
      } catch {
        const rollbackMap = { ...feedbackMapRef.current }
        delete rollbackMap[messageId]
        updateFeedbackMap(rollbackMap)
      } finally {
        feedbackInFlightRef.current.delete(messageId)
      }
    },
    [activeConversationId, updateFeedbackMap]
  )

  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const shouldScrollAfterHistory = useRef(false)
  const historyMessageCount = useRef(0)

  useEffect(() => {
    if (viewState !== 'loading_history' || !activeConversationId) return

    const controller = new AbortController()

    fetch(`/api/chat/history?conversationId=${encodeURIComponent(activeConversationId)}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { messages?: UIMessage[]; nextCursor?: number | null }) => {
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages)
          historyMessageCount.current = data.messages.length
          shouldScrollAfterHistory.current = true
        }
        setHistoryCursor(data.nextCursor ?? null)
        setViewState('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('[Reme:Chat] Failed to load history:', err)
        setViewState('ready')
      })

    return () => {
      controller.abort()
    }
  }, [viewState, activeConversationId, setMessages])

  useEffect(() => {
    if (!shouldScrollAfterHistory.current || viewState !== 'ready' || messages.length === 0) return
    shouldScrollAfterHistory.current = false

    requestAnimationFrame(() => {
      const container = chatContainerRef.current
      if (!container) return
      isAutoScrolling.current = true
      container.scrollTop = container.scrollHeight - container.clientHeight
      lastScrollTop.current = container.scrollTop
      requestAnimationFrame(() => {
        isAutoScrolling.current = false
      })
    })
  }, [viewState, messages.length])

  const loadMoreMessages = useCallback(() => {
    if (!activeConversationId || historyCursor === null || isLoadingMore) return

    const controller = new AbortController()
    setIsLoadingMore(true)

    fetch(
      `/api/chat/history?conversationId=${encodeURIComponent(activeConversationId)}&cursor=${historyCursor}`,
      { signal: controller.signal }
    )
      .then((res) => res.json())
      .then((data: { messages?: UIMessage[]; nextCursor?: number | null }) => {
        const older = data.messages
        if (older && older.length > 0) {
          setMessages((prev) => [...older, ...prev])
          historyMessageCount.current += older.length
        }
        setHistoryCursor(data.nextCursor ?? null)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('[Reme:Chat] Failed to load more history:', err)
      })
      .finally(() => {
        setIsLoadingMore(false)
      })
  }, [activeConversationId, historyCursor, isLoadingMore, setMessages])

  const checkIfNearBottom = useCallback(() => {
    if (!chatContainerRef.current) return true
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
    return scrollHeight - scrollTop - clientHeight < UI.SCROLL_THRESHOLD
  }, [])

  const isHeaderHidden = useRef(false)

  useEffect(() => {
    const container = chatContainerRef.current
    if (!container) return

    let lastScrollY = container.scrollTop
    let ticking = false

    const updateHeader = () => {
      const currentScrollTop = container.scrollTop
      const scrollDiff = currentScrollTop - lastScrollY
      const maxScroll = container.scrollHeight - container.clientHeight
      const isAtBottom = maxScroll - currentScrollTop < 20

      if (currentScrollTop <= 10) {
        if (isHeaderHidden.current) {
          isHeaderHidden.current = false
          setIsHeaderVisible(true)
        }
      } else if (scrollDiff > 5 && currentScrollTop > 60) {
        if (!isHeaderHidden.current) {
          isHeaderHidden.current = true
          setIsHeaderVisible(false)
        }
      } else if (scrollDiff < -10 && !isAtBottom) {
        if (isHeaderHidden.current) {
          isHeaderHidden.current = false
          setIsHeaderVisible(true)
        }
      }

      lastScrollY = currentScrollTop
      ticking = false
    }

    const handleScroll = () => {
      if (isAutoScrolling.current) return

      const nearBottom = checkIfNearBottom()
      userScrolledAway.current = !nearBottom
      setShowScrollButton(!nearBottom)

      lastScrollTop.current = Math.max(0, container.scrollTop)

      if (!ticking) {
        requestAnimationFrame(updateHeader)
        ticking = true
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [checkIfNearBottom, setIsHeaderVisible])

  const scrollToBottomInstant = useCallback(() => {
    const container = chatContainerRef.current
    if (!container) return

    const maxScrollTop = container.scrollHeight - container.clientHeight
    if (maxScrollTop - container.scrollTop <= 5) return

    isAutoScrolling.current = true
    container.scrollTop = maxScrollTop
    lastScrollTop.current = container.scrollTop

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isAutoScrolling.current = false
      })
    })
  }, [])

  useEffect(() => {
    if (status === 'submitted' && prevStatusRef.current !== 'submitted') {
      userScrolledAway.current = false
      setShowScrollButton(false)
      const container = chatContainerRef.current
      if (container) {
        isAutoScrolling.current = true
        container.scrollTop = container.scrollHeight - container.clientHeight
        lastScrollTop.current = container.scrollTop
        requestAnimationFrame(() => {
          isAutoScrolling.current = false
        })
      }
    }
    prevStatusRef.current = status
  }, [status])

  const lastContentLength = useRef(0)

  useEffect(() => {
    if (userScrolledAway.current) return

    if (status !== 'streaming') {
      lastContentLength.current = 0
      return
    }

    const currentLastMessage = messages[messages.length - 1]
    if (!currentLastMessage || currentLastMessage.role !== 'assistant') return

    const contentLength = extractTextFromParts(currentLastMessage.parts).length
    if (contentLength <= lastContentLength.current) return
    lastContentLength.current = contentLength

    scrollToBottomInstant()
  }, [messages, status, scrollToBottomInstant])

  const scrollToBottom = useCallback(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [])

  useEffect(() => {
    if (status === 'ready' || status === 'error') {
      sendingRef.current = false
    }
  }, [status])

  const handleSend = useCallback(
    (message: string) => {
      if (!message.trim() || sendingRef.current) return
      sendingRef.current = true
      sendMessage({ text: message })
    },
    [sendMessage]
  )

  const errorMessage = error?.message

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div
        ref={chatContainerRef}
        className="custom-scrollbar flex-1 overflow-y-auto px-4 pt-6 md:px-0"
        style={{
          maskImage: 'linear-gradient(to bottom, black 95%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 95%, transparent 100%)',
        }}
      >
        <div className="mx-auto w-full max-w-4xl px-4 md:px-8">
          {/* ── View states (mutually exclusive) ──────────────────────── */}

          {viewState !== 'ready' && <ChatHistorySkeleton />}

          {viewState === 'ready' && messages.length === 0 && <EmptyState onSend={handleSend} />}

          {viewState === 'ready' && messages.length > 0 && (
            <div>
              {historyCursor !== null && (
                <div className="mb-4 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMoreMessages}
                    disabled={isLoadingMore}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-text-secondary text-sm brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingMore ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                        Loading...
                      </>
                    ) : (
                      'Load more'
                    )}
                  </button>
                </div>
              )}

              <MessageList
                messages={messages}
                historyCount={historyMessageCount.current}
                onSuggestionClick={handleSend}
                onFeedback={handleFeedback}
                feedbackMap={feedbackMap}
              />

              {showTypingIndicator && <TypingIndicator />}
              {errorMessage && (
                <div className="mb-4 rounded-xl border border-status-error/20 bg-status-error/10 p-4 text-status-error text-sm">
                  Error: {errorMessage}
                </div>
              )}

              <div className="h-40" />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Gradient Overlay */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 fade-overlay-bottom"
        style={{ zIndex: Z_INDEX.BASE }}
      />

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <IconButton
          icon={<ChevronDown className="w-5 h-5" />}
          label="Scroll to bottom"
          onClick={scrollToBottom}
          variant="glass"
          className="absolute bottom-40 right-6"
          style={{ zIndex: Z_INDEX.HEADER }}
        />
      )}

      {/* Input area — always visible, statically rendered */}
      <div
        className="pointer-events-none absolute bottom-4 left-0 right-0 px-4"
        style={{ zIndex: Z_INDEX.OVERLAY }}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-3xl">
          <ChatInput onSend={handleSend} disabled={false} isLoading={isLoading} />
        </div>
      </div>
    </div>
  )
}

interface MessageListProps {
  messages: UIMessage[]
  historyCount: number
  onSuggestionClick: (suggestion: string) => void
  onFeedback: (messageId: string, rating: FeedbackRating) => void
  feedbackMap: Record<string, FeedbackRating>
}

const MessageList = memo(function MessageList({
  messages,
  historyCount,
  onSuggestionClick,
  onFeedback,
  feedbackMap,
}: MessageListProps) {
  const { deduped, lastAssistantIdx } = useMemo(() => {
    const seen = new Set<string>()
    let lastAst = -1
    const items = messages.reduce<Array<{ msg: UIMessage; idx: number }>>((acc, msg, idx) => {
      const key = msg.id || `msg-${idx}`
      if (seen.has(key)) return acc
      seen.add(key)
      if (msg.role === 'assistant') lastAst = idx
      acc.push({ msg, idx })
      return acc
    }, [])
    return { deduped: items, lastAssistantIdx: lastAst }
  }, [messages])

  return (
    <>
      {deduped.map(({ msg: message, idx: index }) => {
        const content = extractTextFromParts(message.parts)
        const messageKey = message.id ? `${message.id}-${index}` : `msg-${index}`
        const isFromHistory = index < historyCount

        const createdAt =
          message.metadata &&
          typeof message.metadata === 'object' &&
          'createdAt' in message.metadata
            ? new Date(message.metadata.createdAt as number)
            : new Date()

        if (message.role === 'user') {
          return (
            <InlineUserMessage
              key={messageKey}
              content={content}
              createdAt={createdAt}
              animate={!isFromHistory}
            />
          )
        }

        let previousUserMessage: string | undefined
        for (let i = index - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            previousUserMessage = extractTextFromParts(messages[i].parts)
            break
          }
        }

        return (
          <MessageBubble
            key={messageKey}
            message={{
              id: message.id,
              role: message.role as 'user' | 'assistant',
              content,
              parts: message.parts as MessagePart[] | undefined,
              createdAt,
            }}
            previousUserMessage={previousUserMessage}
            onSuggestionClick={onSuggestionClick}
            isLastAssistantMessage={index === lastAssistantIdx}
            animate={!isFromHistory}
            onFeedback={onFeedback}
            feedbackState={feedbackMap[message.id] ?? null}
          />
        )
      })}
    </>
  )
})
