'use client'

import { useEffect, useRef } from 'react'

type EventHandler = (event: MouseEvent | TouchEvent) => void

/**
 * Hook that detects clicks outside of the specified element
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: EventHandler,
  enabled = true
): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref.current

      if (!el || el.contains(event.target as Node)) {
        return
      }

      handlerRef.current(event)
    }

    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)

    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [enabled])

  return ref
}
