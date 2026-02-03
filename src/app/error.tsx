'use client'

import Link from 'next/link'
import { useEffect } from 'react'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-primary px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-status-error/10">
            <svg
              className="h-8 w-8 text-status-error"
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

        <h1 className="mb-2 font-semibold text-2xl text-text-primary">Something went wrong</h1>
        <p className="mb-6 text-text-secondary">
          An unexpected error occurred. Our team has been notified.
        </p>

        {error.digest && (
          <p className="mb-6 font-mono text-text-muted text-xs">Error ID: {error.digest}</p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-brand px-6 py-2.5 font-medium text-surface-primary transition-colors hover:bg-brand-accent focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface-primary"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border bg-surface-elevated px-6 py-2.5 font-medium text-text-primary transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface-primary"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
