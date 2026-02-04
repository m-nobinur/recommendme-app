'use client'

import type React from 'react'
import { memo, useEffect, useState } from 'react'
import { Logo } from '@/components/ui/Logo'

interface TypingIndicatorProps {
  text?: string | null
}

const THINKING_STATES = ['Working on it...', 'Just a moment...', "I'm on it...", 'Processing...']

const TypingIndicator: React.FC<TypingIndicatorProps> = memo(({ text }) => {
  const [loadingText, setLoadingText] = useState(
    () => THINKING_STATES[Math.floor(Math.random() * THINKING_STATES.length)]
  )

  useEffect(() => {
    if (text) return

    let currentIndex = THINKING_STATES.indexOf(loadingText)

    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % THINKING_STATES.length
      setLoadingText(THINKING_STATES[currentIndex])
    }, 4000) // Cycle every 4 seconds

    return () => clearInterval(interval)
  }, [text, loadingText])

  const displayText = text || loadingText

  return (
    <div className="mb-4 flex w-full flex-col items-start px-4 md:px-0">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-[#121212] shadow-lg shadow-black/40">
          {/* Professional Logo Icon */}
          <div className="relative flex h-full w-full items-center justify-center">
            <Logo size={16} className="animate-pulse" />
          </div>
        </div>

        <div className="flex h-5 items-center overflow-hidden">
          <span
            key={displayText}
            className="fade-in slide-in-from-bottom-2 animate-in font-mono text-[11px] text-amber-500/80 duration-300"
          >
            {displayText}
          </span>
        </div>
      </div>
    </div>
  )
})

TypingIndicator.displayName = 'TypingIndicator'

export default TypingIndicator
