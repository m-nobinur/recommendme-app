import { SkeletonChatHistory, SkeletonInput } from '@/components/ui/Skeleton'

export default function ChatLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b px-6 py-4">
        <div className="animate-pulse">
          <div className="h-6 w-24 rounded bg-surface-elevated" />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden">
        <SkeletonChatHistory count={5} />
      </div>

      {/* Input area */}
      <div className="border-border border-t p-4">
        <div className="mx-auto max-w-3xl">
          <SkeletonInput className="h-12" />
        </div>
      </div>
    </div>
  )
}
