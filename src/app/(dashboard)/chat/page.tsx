import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ChatContainer } from './components/ChatContainer'
import { ChatSkeleton } from './components/ChatSkeleton'

export const metadata: Metadata = {
  title: 'Chat - Reme',
  description: 'Chat with your AI-powered business assistant',
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContainer />
    </Suspense>
  )
}
