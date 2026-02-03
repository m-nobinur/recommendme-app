'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

interface HeaderContextType {
  isHeaderVisible: boolean
  setIsHeaderVisible: (visible: boolean) => void
}

const HeaderContext = createContext<HeaderContextType>({
  isHeaderVisible: true,
  setIsHeaderVisible: () => {},
})

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true)

  return (
    <HeaderContext.Provider value={{ isHeaderVisible, setIsHeaderVisible }}>
      {children}
    </HeaderContext.Provider>
  )
}

export function useHeader() {
  return useContext(HeaderContext)
}
