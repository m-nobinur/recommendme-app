'use client'

import { Bug, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { COOKIES } from '@/lib/constants'
import { cn } from '@/lib/utils/cn'
import { useDevModeStore } from '@/stores'

async function setCookie(name: string, value: string) {
  const expiresMs = Date.now() + 365 * 24 * 60 * 60 * 1000

  if (typeof window !== 'undefined' && 'cookieStore' in window) {
    await window.cookieStore.set({ name, value, path: '/', expires: expiresMs, sameSite: 'lax' })
  } else {
    // biome-ignore lint/suspicious/noDocumentCookie: fallback for browsers without Cookie Store API
    document.cookie = `${name}=${value};path=/;expires=${new Date(expiresMs).toUTCString()};samesite=lax`
  }
}

export function DevModeBanner() {
  const { authMode, setAuthMode } = useDevModeStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    void setCookie(COOKIES.DEV_AUTH_MODE, authMode)
  }, [authMode])

  const handleToggle = useCallback(async () => {
    const nextMode = authMode === 'dev' ? 'user' : 'dev'
    setAuthMode(nextMode)
    await setCookie(COOKIES.DEV_AUTH_MODE, nextMode)
    window.location.reload()
  }, [authMode, setAuthMode])

  if (!mounted) return null

  const isDev = authMode === 'dev'

  return (
    <div className="fixed bottom-4 right-4 z-100 flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm transition-all duration-200 border',
          isDev
            ? 'border-amber-500/30 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
            : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
        )}
        title={isDev ? 'Switch to User Mode (requires login)' : 'Switch to Dev Mode (mock auth)'}
      >
        {isDev ? <Bug className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        <span>{isDev ? 'Dev Mode' : 'User Mode'}</span>
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            isDev ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
          )}
        />
      </button>
    </div>
  )
}
