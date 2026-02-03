'use client'

import { Brain, Check, ChevronDown, Sparkles, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelTier } from '@/lib/ai/providers/types'
import { BRAIN_TIERS, PROVIDERS, useModelStore } from '@/stores'

const TIER_RATINGS: Record<ModelTier, { intelligence: number; speed: number }> = {
  smartest: { intelligence: 5, speed: 3 },
  smart: { intelligence: 4, speed: 4 },
  regular: { intelligence: 3, speed: 5 },
}

interface RatingBarProps {
  value: number
  label: string
  color: string
}

function RatingBar({ value, label, color }: RatingBarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-gray-500 uppercase tracking-wide w-12">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-2 h-1.5 rounded-sm transition-colors ${
              i <= value ? color : 'bg-surface-muted'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

function BrainSwitcherComponent() {
  const provider = useModelStore((s) => s.provider)
  const brainTier = useModelStore((s) => s.brainTier)
  const setBrainTier = useModelStore((s) => s.setBrainTier)

  const currentProvider = PROVIDERS[provider]
  const tierInfo = BRAIN_TIERS[brainTier]

  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const tiers = Object.keys(BRAIN_TIERS) as ModelTier[]

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const dropdownHeight = 320
      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom

      const openAbove = spaceAbove > dropdownHeight || spaceAbove > spaceBelow

      if (openAbove) {
        setDropdownStyle({
          position: 'fixed',
          bottom: `${window.innerHeight - rect.top + 8}px`,
          left: `${rect.left}px`,
          zIndex: 9999,
        })
      } else {
        setDropdownStyle({
          position: 'fixed',
          top: `${rect.bottom + 8}px`,
          left: `${rect.left}px`,
          zIndex: 9999,
        })
      }
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleSelect = useCallback(
    (tier: ModelTier) => {
      setBrainTier(tier)
      setIsOpen(false)
    },
    [setBrainTier]
  )

  const getIcon = (iconType: string, isSelected: boolean) => {
    const className = `w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-gray-500'}`

    if (iconType === 'sparkles') return <Sparkles className={className} />
    if (iconType === 'zap') return <Zap className={className} />
    return <Zap className={className} />
  }

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="w-72 overflow-hidden rounded-xl border border-border bg-surface-tertiary/95 backdrop-blur-xl shadow-2xl shadow-black/60"
      style={dropdownStyle}
    >
      <div className="px-4 py-3 border-b border-surface-muted">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-gray-200">Reme's Brain</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          Powered by <span className="text-amber-500/80">{currentProvider.name}</span>
        </p>
      </div>

      <div className="py-1">
        {tiers.map((tier) => {
          const info = BRAIN_TIERS[tier]
          const model = currentProvider.models[tier]
          const ratings = TIER_RATINGS[tier]
          const isSelected = tier === brainTier

          return (
            <button
              key={tier}
              type="button"
              onClick={() => handleSelect(tier)}
              className={`w-full px-4 py-3 flex items-start gap-3 transition-all duration-150 ${
                isSelected ? 'bg-amber-500/10' : 'hover:bg-surface-elevated'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-amber-500/20 border border-amber-500/30'
                    : 'bg-border-subtle border border-surface-muted'
                }`}
              >
                {getIcon(info.icon, isSelected)}
              </div>

              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${isSelected ? 'text-amber-400' : 'text-gray-200'}`}
                  >
                    {info.label}
                  </span>
                  {tier === 'smart' && (
                    <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded bg-amber-500/15 text-amber-500/80">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{model.name}</p>

                <div className="mt-2 flex flex-col gap-1">
                  <RatingBar value={ratings.intelligence} label="Smart" color="bg-amber-500" />
                  <RatingBar value={ratings.speed} label="Speed" color="bg-emerald-500" />
                </div>
              </div>

              {isSelected && <Check className="w-4 h-4 text-amber-500 shrink-0 mt-1" />}
            </button>
          )
        })}
      </div>

      <div className="px-4 py-2 border-t border-surface-muted">
        <span className="text-[10px] text-gray-600">Change provider in Settings</span>
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
          isOpen
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            : 'border-transparent bg-surface-elevated text-gray-400 hover:border-border hover:bg-[#151515] hover:text-gray-300'
        }`}
      >
        <Brain className={`w-3.5 h-3.5 ${isOpen ? 'text-amber-400' : 'text-amber-500'}`} />
        <span className="hidden sm:inline">{tierInfo.label}</span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {mounted && isOpen && createPortal(dropdownContent, document.body)}
    </>
  )
}

const BrainSwitcher = memo(BrainSwitcherComponent)
export default BrainSwitcher
