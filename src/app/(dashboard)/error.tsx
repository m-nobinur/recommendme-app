'use client'

import { useEffect } from 'react'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-error/10">
            <svg
              className="h-7 w-7 text-status-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        <h2 className="mb-2 font-semibold text-text-primary text-xl">Something went wrong</h2>
        <p className="mb-6 text-sm text-text-secondary">
          There was a problem loading this page. Please try again.
        </p>

        {error.digest && (
          <p className="mb-4 font-mono text-text-muted text-xs">Error ID: {error.digest}</p>
        )}

        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand px-5 py-2 font-medium text-surface-primary transition-colors hover:bg-brand-accent focus-ring"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
