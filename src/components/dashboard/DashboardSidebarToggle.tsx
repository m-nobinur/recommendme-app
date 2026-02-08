'use client'

import { PanelLeft } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { UI } from '@/lib/constants'

interface DashboardSidebarToggleProps {
  isOpen: boolean
  onToggle: () => void
}

export function DashboardSidebarToggle({ isOpen, onToggle }: DashboardSidebarToggleProps) {
  return (
    <IconButton
      onClick={onToggle}
      style={{
        marginLeft: isOpen ? `${UI.SIDEBAR_WIDTH - 55}px` : '0',
        transition: 'margin 300ms ease-out',
      }}
      variant={isOpen ? 'secondary' : 'glass'}
      label={isOpen ? 'Hide Dashboard' : 'Show Dashboard'}
      className={`pointer-events-auto transition-all duration-300 ${!isOpen ? 'opacity-50 hover:opacity-100 hover:scale-110' : ''}`}
      icon={
        <PanelLeft
          className={`w-5 h-5 transition-transform duration-300 ${isOpen ? 'rotate-180 text-brand' : 'text-text-secondary'}`}
        />
      }
    />
  )
}
