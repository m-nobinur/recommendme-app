export function ChatSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Messages area skeleton */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex h-full min-h-[60vh] max-w-3xl flex-col items-center justify-center">
          {/* Logo skeleton */}
          <div className="mb-6 h-20 w-20 animate-pulse rounded-2xl bg-surface-muted" />

          {/* Title skeleton */}
          <div className="mb-3 h-8 w-48 animate-pulse rounded-lg bg-surface-muted" />

          {/* Description skeleton */}
          <div className="mb-8 h-12 w-80 animate-pulse rounded-lg bg-surface-muted" />

          {/* Suggestion buttons skeleton */}
          <div className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-xl bg-surface-muted"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Input area skeleton */}
      <div className="flex-shrink-0 p-4 pt-0 md:p-6">
        <div className="mx-auto max-w-3xl">
          <div className="h-14 animate-pulse rounded-2xl border border-border bg-surface-muted" />
        </div>
      </div>
    </div>
  )
}
