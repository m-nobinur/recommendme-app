'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/lib/constants'

type AuthMode = 'dev' | 'user'

interface DevModeState {
  authMode: AuthMode
  setAuthMode: (mode: AuthMode) => void
  toggleAuthMode: () => void
}

export const useDevModeStore = create<DevModeState>()(
  persist(
    (set, get) => ({
      authMode: 'dev',
      setAuthMode: (mode) => set({ authMode: mode }),
      toggleAuthMode: () => set({ authMode: get().authMode === 'dev' ? 'user' : 'dev' }),
    }),
    {
      name: STORAGE_KEYS.DEV_MODE,
    }
  )
)
