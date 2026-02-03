export function SettingsSkeleton() {
  return (
    <>
      {/* Provider Section Skeleton */}
      <section className="mb-8">
        <div className="mb-4 h-6 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="mb-4 h-4 w-3/4 animate-pulse rounded bg-surface-muted" />

        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-4 rounded-xl border border-border bg-surface-tertiary p-4"
            >
              <div
                className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-surface-muted"
                style={{ animationDelay: `${i * 100}ms` }}
              />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-32 animate-pulse rounded bg-surface-muted" />
                <div className="h-4 w-48 animate-pulse rounded bg-surface-muted" />
                <div className="mt-2 space-y-1">
                  <div className="h-3 w-56 animate-pulse rounded bg-surface-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-surface-muted" />
                  <div className="h-3 w-40 animate-pulse rounded bg-surface-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Model Section Skeleton */}
      <section className="mb-8">
        <div className="mb-4 h-6 w-24 animate-pulse rounded bg-surface-muted" />
        <div className="mb-4 h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
        <div className="h-14 w-full animate-pulse rounded-xl border border-border bg-surface-muted" />
      </section>

      {/* API Key Notice Skeleton */}
      <section className="mb-8">
        <div className="rounded-xl border border-border bg-surface-tertiary p-4">
          <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
        </div>
      </section>

      {/* Button Skeleton */}
      <div className="h-10 w-32 animate-pulse rounded-xl bg-surface-muted" />
    </>
  )
}
