'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ChevronDown } from 'lucide-react'
import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatInput from '@/components/chat/ChatInput'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { IconButton } from '@/components/ui/IconButton'
import { Logo } from '@/components/ui/Logo'
import { useHeader } from '@/contexts/HeaderContext'
import { API, UI, Z_INDEX } from '@/lib/constants'
import { useModelStore } from '@/stores'
import type { MessagePart } from '@/types'

const MessageBubble = dynamic(() => import('@/components/chat/MessageBubble'), {
  loading: () => null,
  ssr: false,
})

const InlineUserMessage = memo(function InlineUserMessage({
  content,
  createdAt,
}: {
  content: string
  createdAt: Date
}) {
  const formattedTime = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex w-full justify-end fade-in slide-in-from-bottom-2 group mb-6 animate-in duration-300">
      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        <div className="relative overflow-hidden rounded-2xl rounded-tr-none border border-[#252525] bg-linear-to-br from-surface-muted to-[#111] text-[15px] leading-relaxed text-gray-100">
          <div className="relative px-5 py-3.5">
            <p className="text-gray-100">{content}</p>
          </div>
        </div>
        <div className="mt-1.5 mr-1 flex items-center justify-end gap-2">
          <span className="font-medium text-[11px] text-gray-500">{formattedTime}</span>
          <span className="text-[10px] text-emerald-500/70">✓✓</span>
        </div>
      </div>
    </div>
  )
})

const SUGGESTIONS = [
  'Add a new lead named John Smith',
  'Show me my schedule for today',
  'Create an invoice for $500',
  'List all my leads',
] as const

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
  const lastScrollTop = useRef(0)
  const isAutoScrolling = useRef(false)
  const { setIsHeaderVisible } = useHeader()

  const provider = useModelStore((s) => s.provider)
  const brainTier = useModelStore((s) => s.brainTier)

  const userScrolledAway = useRef(false)
  const prevStatusRef = useRef<string>('')

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: API.CHAT_ENDPOINT,
      body: {
        provider,
        tier: brainTier,
      },
    }),
    onError: (error) => {
      console.error('Chat error:', error)
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'
  const showTypingIndicator = status === 'submitted'

  const checkIfNearBottom = useCallback(() => {
    if (!chatContainerRef.current) return true
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
    const threshold = UI.SCROLL_THRESHOLD
    return scrollHeight - scrollTop - clientHeight < threshold
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
      } else if (scrollDiff < -30) {
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
      if (!nearBottom) {
        userScrolledAway.current = true
      } else {
        userScrolledAway.current = false
      }
      setShowScrollButton(!nearBottom)

      lastScrollTop.current = Math.max(0, container.scrollTop)

      if (!ticking) {
        requestAnimationFrame(updateHeader)
        ticking = true
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
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

    const currentContent = extractTextFromParts(currentLastMessage.parts)
    const contentLength = currentContent.length

    if (contentLength <= lastContentLength.current) return
    lastContentLength.current = contentLength

    scrollToBottomInstant()
  }, [messages, status, scrollToBottomInstant])

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

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      handleSend(suggestion)
    },
    [handleSend]
  )

  const emptyStateUI = useMemo(
    () => (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-linear-to-br from-[#121212] to-surface-muted shadow-xl">
          <Logo size={48} />
        </div>
        <h2 className="mb-3 bg-linear-to-r from-amber-400 to-orange-500 bg-clip-text font-bold text-2xl text-transparent">
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
                const content = extractTextFromParts(message.parts)

                const createdAt =
                  message.metadata &&
                  typeof message.metadata === 'object' &&
                  'createdAt' in message.metadata
                    ? new Date(message.metadata.createdAt as number)
                    : new Date()

                if (message.role === 'user') {
                  return (
                    <InlineUserMessage key={message.id} content={content} createdAt={createdAt} />
                  )
                }

                let previousUserMessage: string | undefined
                if (index > 0) {
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
              {showTypingIndicator && <TypingIndicator />}
              {errorUI}

              <div className="h-40" />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Bottom Gradient Overlay */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-linear-to-t from-black via-black/80 to-transparent"
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

      {/* Input area - Floating Glass Effect */}
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
