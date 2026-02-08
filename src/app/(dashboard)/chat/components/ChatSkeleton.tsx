import { Skeleton, SkeletonInput } from '@/components/ui/Skeleton'

export function ChatSkeleton() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 pt-6 md:px-0">
        <div className="mx-auto w-full max-w-4xl px-4 md:px-8">
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
            <Skeleton className="mb-6 h-20 w-20 rounded-2xl" />
            <Skeleton className="mb-3 h-8 w-48 rounded-lg" />
            <Skeleton className="mb-8 h-12 w-80 rounded-lg" />
            <div className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-12 rounded-xl"
                  style={{ animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 px-4">
        <div className="mx-auto max-w-3xl">
          <SkeletonInput className="h-14 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

function UserBubbleSkeleton({ width, delay = 0 }: { width: string; delay?: number }) {
  return (
    <div className="flex w-full justify-end mb-6" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        <div className="relative overflow-hidden rounded-2xl rounded-tr-none border border-[#252525] bg-linear-to-br from-surface-muted to-[#111]">
          <div className="px-5 py-3.5">
            <Skeleton className={`h-4 ${width} rounded bg-surface-muted`} />
          </div>
        </div>
        <div className="mt-1.5 mr-1 flex items-center justify-end gap-2">
          <Skeleton className="h-2.5 w-10 rounded-full" />
          <Skeleton className="h-2.5 w-4 rounded-full" />
        </div>
      </div>
    </div>
  )
}

function AssistantBubbleSkeleton({
  lines,
  delay = 0,
}: {
  lines: Array<{ width: string }>
  delay?: number
}) {
  return (
    <div className="flex w-full justify-start mb-6" style={{ animationDelay: `${delay}ms` }}>
      <div className="mt-1 mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-linear-to-tr from-[#121212] to-surface-muted shadow-black/40 shadow-lg">
        <Skeleton className="h-5 w-5 rounded bg-transparent" />
      </div>

      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        <div className="mb-2 ml-1 flex items-center gap-2">
          <Skeleton className="h-3 w-10 rounded-full" />
          <span className="h-1 w-1 rounded-full bg-gray-600/40" />
          <Skeleton className="h-2.5 w-10 rounded-full" />
        </div>

        <div className="relative overflow-hidden rounded-2xl rounded-tl-none border border-surface-muted bg-linear-to-br from-[#111] to-surface-tertiary shadow-black/20 shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-amber-500/2 to-transparent" />
          <div className="relative px-5 py-4 space-y-2.5">
            {lines.map((line, i) => (
              <Skeleton
                key={i}
                className={`h-3.5 ${line.width} rounded bg-surface-muted`}
                style={{ animationDelay: `${delay + i * 80}ms` }}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 flex gap-2 overflow-hidden ml-1">
          {[{ w: 'w-28' }, { w: 'w-36' }, { w: 'w-24' }].map((pill, i) => (
            <div
              key={i}
              className={`relative ${pill.w} h-[30px] rounded-full overflow-hidden border border-surface-muted shrink-0`}
            >
              <div className="absolute inset-0 bg-surface-tertiary" />
              <div
                className="absolute inset-0 shimmer-skeleton"
                style={{ animationDelay: `${delay + 200 + i * 150}ms` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Inline skeleton shown inside ChatContainer while conversation history is being fetched.
 */
export function ChatHistorySkeleton() {
  return (
    <div className="flex flex-col py-4 animate-in fade-in duration-500">
      <UserBubbleSkeleton width="w-44" delay={0} />
      <AssistantBubbleSkeleton
        lines={[{ width: 'w-full' }, { width: 'w-[90%]' }, { width: 'w-[75%]' }]}
        delay={100}
      />

      <UserBubbleSkeleton width="w-56" delay={200} />
      <AssistantBubbleSkeleton
        lines={[
          { width: 'w-full' },
          { width: 'w-[85%]' },
          { width: 'w-full' },
          { width: 'w-[60%]' },
        ]}
        delay={300}
      />
    </div>
  )
}
