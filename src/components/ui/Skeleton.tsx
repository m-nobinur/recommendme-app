import { cn } from '@/lib/utils/cn'

interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div className={cn('animate-pulse rounded-md bg-surface-elevated', className)} style={style} />
  )
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-3/4' : 'w-full')} />
      ))}
    </div>
  )
}

export function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn('h-10 w-10 rounded-full', className)} />
}

export function SkeletonButton({ className }: { className?: string }) {
  return <Skeleton className={cn('h-10 w-24 rounded-lg', className)} />
}

export function SkeletonInput({ className }: { className?: string }) {
  return <Skeleton className={cn('h-10 w-full rounded-lg', className)} />
}

export function SkeletonMessage({
  isUser = false,
  className,
}: {
  isUser?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row', className)}>
      <SkeletonAvatar className="h-8 w-8 shrink-0" />
      <div className={cn('max-w-[70%] space-y-2', isUser ? 'items-end' : 'items-start')}>
        <Skeleton className={cn('h-4 w-20', isUser ? 'ml-auto' : '')} />
        <Skeleton
          className={cn('h-20 rounded-2xl', isUser ? 'w-48 rounded-tr-sm' : 'w-64 rounded-tl-sm')}
        />
      </div>
    </div>
  )
}

export function SkeletonChatHistory({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-6 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonMessage key={i} isUser={i % 2 === 1} />
      ))}
    </div>
  )
}

export function SkeletonAuthForm() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-8 w-32" />
        <Skeleton className="mx-auto h-4 w-48" />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <SkeletonInput />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <SkeletonInput />
        </div>
        <SkeletonButton className="w-full" />
      </div>
      <Skeleton className="mx-auto h-4 w-40" />
    </div>
  )
}

export function SkeletonSettings() {
  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-28" />
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-border bg-surface-secondary p-4"
            >
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-6 w-12 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-20" />
        <SkeletonInput />
      </div>

      <SkeletonButton className="w-32" />
    </div>
  )
}
