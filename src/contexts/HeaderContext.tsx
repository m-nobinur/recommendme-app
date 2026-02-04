'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

interface HeaderContextType {
  isHeaderVisible: boolean
  setIsHeaderVisible: (visible: boolean) => void
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined)

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true)

  const setHeaderVisible = useCallback((visible: boolean) => {
    setIsHeaderVisible(visible)
  }, [])

  const value = useMemo(
    () => ({ isHeaderVisible, setIsHeaderVisible: setHeaderVisible }),
    [isHeaderVisible, setHeaderVisible]
  )

  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>
}

export function useHeader() {
  const context = useContext(HeaderContext)
  if (context === undefined) {
    throw new Error('useHeader must be used within HeaderProvider')
  }
  return context
}
