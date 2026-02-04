export function DashboardSkeleton() {
  return (
    <div className="flex h-screen flex-col bg-surface-secondary">
      {/* Header skeleton */}
      <header className="h-16 shrink-0 border-border border-b bg-surface-tertiary/80">
        <div className="flex h-full items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-muted" />
            <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-muted" />
            <div className="h-6 w-16 animate-pulse rounded bg-surface-muted" />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden h-4 w-24 animate-pulse rounded bg-surface-muted sm:block" />
            <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-muted" />
            <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-muted" />
          </div>
        </div>
      </header>

      {/* Main content skeleton */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col items-center justify-center p-4">
          <div className="w-full max-w-3xl space-y-4">
            {/* Chat messages skeleton */}
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="h-12 w-64 animate-pulse rounded-2xl bg-surface-muted" />
              </div>
              <div className="flex justify-start">
                <div className="h-24 w-80 animate-pulse rounded-2xl bg-surface-muted" />
              </div>
              <div className="flex justify-end">
                <div className="h-12 w-48 animate-pulse rounded-2xl bg-surface-muted" />
              </div>
            </div>

            {/* Input skeleton */}
            <div className="fixed right-0 bottom-0 left-0 p-4">
              <div className="mx-auto max-w-3xl">
                <div className="h-14 animate-pulse rounded-2xl border border-border bg-surface-muted" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
