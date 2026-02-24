'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/lib/constants'

interface PersistedChatState {
  conversationId: string | null
}

interface ChatState extends PersistedChatState {
  hasHydrated: boolean
  setHasHydrated: (value: boolean) => void
  getOrCreateConversationId: () => string
  newConversation: () => string
  setConversationId: (id: string) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversationId: null,
      hasHydrated: false,

      setHasHydrated: (value: boolean) => {
        set({ hasHydrated: value })
      },

      getOrCreateConversationId: () => {
        const current = get().conversationId
        if (current) return current

        const newId = crypto.randomUUID()
        set({ conversationId: newId })
        return newId
      },

      newConversation: () => {
        const newId = crypto.randomUUID()
        set({ conversationId: newId })
        return newId
      },

      setConversationId: (id: string) => {
        set({ conversationId: id })
      },
    }),
    {
      name: STORAGE_KEYS.CHAT_STATE,
      version: 2,
      partialize: (state): PersistedChatState => ({
        conversationId: state.conversationId,
      }),
      migrate: (_persisted, version) => {
        if (version < 2) {
          const old = _persisted as { conversationId?: string | null }
          return { conversationId: old?.conversationId ?? null }
        }
        return _persisted as PersistedChatState
      },
      onRehydrateStorage: () => {
        return (state) => {
          state?.setHasHydrated(true)
        }
      },
    }
  )
)
