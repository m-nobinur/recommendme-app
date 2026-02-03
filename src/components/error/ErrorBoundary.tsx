'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Generic Error Boundary Component
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
            <Logo size={32} />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-100">Something went wrong</h2>
          <p className="mb-6 text-gray-500 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <Button onClick={this.handleReset} variant="primary">
            Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Chat-specific Error Boundary
 */
interface ChatErrorFallbackProps {
  error: Error | null
  onReset: () => void
}

export function ChatErrorFallback({ error, onReset }: ChatErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/10 to-red-900/10">
        <Logo size={48} />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-gray-100">Chat Error</h2>
      <p className="mb-4 text-gray-500 max-w-md">
        {error?.message || 'Unable to load the chat. Please refresh and try again.'}
      </p>
      <div className="flex gap-3">
        <Button onClick={onReset} variant="secondary">
          Try Again
        </Button>
        <Button onClick={() => window.location.reload()} variant="primary">
          Refresh Page
        </Button>
      </div>
    </div>
  )
}

/**
 * Dashboard-specific Error Boundary
 */
export function DashboardErrorFallback({ error, onReset }: ChatErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
      <h2 className="mb-2 text-lg font-semibold text-gray-100">Dashboard Error</h2>
      <p className="mb-4 text-sm text-gray-500 max-w-sm">
        {error?.message || 'Failed to load dashboard data.'}
      </p>
      <Button onClick={onReset} variant="secondary" size="sm">
        Retry
      </Button>
    </div>
  )
}

/**
 * Async Error Boundary for React Suspense
 */
interface AsyncErrorBoundaryProps {
  children: ReactNode
  errorComponent?: ReactNode
}

export function AsyncErrorBoundary({ children, errorComponent }: AsyncErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={
        errorComponent || (
          <div className="p-4 text-center text-gray-500">
            <p>Something went wrong loading this content.</p>
          </div>
        )
      }
    >
      {children}
    </ErrorBoundary>
  )
}
