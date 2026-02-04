'use client'

import { Check, ChevronDown, ExternalLink, Globe, Sparkles, Zap } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { AIProvider, ModelTier } from '@/lib/ai/providers/types'
import { Z_INDEX } from '@/lib/constants'
import { cn } from '@/lib/utils/cn'
import { BRAIN_TIERS, PROVIDERS, useModelStore } from '@/stores'

// Provider icons
function getProviderIcon(providerId: AIProvider) {
  switch (providerId) {
    case 'openrouter':
      return <Globe className="h-5 w-5" />
    case 'gateway':
      return <Zap className="h-5 w-5" />
    case 'gemini':
      return <Sparkles className="h-5 w-5" />
    default:
      return <Globe className="h-5 w-5" />
  }
}

// Provider features for display
const PROVIDER_FEATURES: Partial<Record<AIProvider, readonly string[]>> = {
  openrouter: [
    '100+ models from OpenAI, Anthropic, Google, Meta',
    'Automatic fallbacks & load balancing',
    'Pay-per-use pricing',
  ],
  gateway: [
    'Edge-optimized for low latency',
    'Built-in response caching',
    'Usage analytics dashboard',
  ],
  gemini: ['Native multimodal support', '1M+ token context window', 'Frontier intelligence'],
}

export function SettingsForm() {
  const provider = useModelStore((s) => s.provider)
  const brainTier = useModelStore((s) => s.brainTier)
  const setProvider = useModelStore((s) => s.setProvider)
  const setBrainTier = useModelStore((s) => s.setBrainTier)

  const [isBrainDropdownOpen, setIsBrainDropdownOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const currentProvider = PROVIDERS[provider]
  const currentModel = currentProvider.models[brainTier]
  const currentTierInfo = BRAIN_TIERS[brainTier]

  const handleProviderChange = useCallback(
    (providerId: AIProvider) => {
      setProvider(providerId)
    },
    [setProvider]
  )

  const handleBrainTierSelect = useCallback(
    (tier: ModelTier) => {
      setBrainTier(tier)
      setIsBrainDropdownOpen(false)
    },
    [setBrainTier]
  )

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      // TODO: Save to Convex when backend is connected
      await new Promise((resolve) => setTimeout(resolve, 800))

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      console.error('Failed to save settings:', error)
    } finally {
      setIsSaving(false)
    }
  }, [])

  const providers = Object.values(PROVIDERS)
  const tiers = Object.keys(BRAIN_TIERS) as ModelTier[]

  return (
    <>
      {/* AI Provider Section */}
      <section className="mb-8">
        <h2 className="mb-4 font-medium text-lg text-white">AI Provider</h2>
        <p className="mb-4 text-gray-400 text-sm">
          Choose which AI service powers Reme. Each provider offers different models for the brain
          tiers.
        </p>

        <div className="grid gap-3">
          {providers.map((providerConfig) => (
            <button
              type="button"
              key={providerConfig.id}
              onClick={() => handleProviderChange(providerConfig.id)}
              className={cn(
                'flex items-start gap-4 rounded-xl border p-4 text-left transition-all',
                'hover:border-border-strong',
                provider === providerConfig.id
                  ? 'border-amber-500 bg-amber-500/5'
                  : 'border-border bg-surface-tertiary'
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  provider === providerConfig.id
                    ? 'bg-amber-500 text-black'
                    : 'bg-surface-elevated text-gray-400'
                )}
              >
                {getProviderIcon(providerConfig.id)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{providerConfig.name}</span>
                  {provider === providerConfig.id && <Check className="h-4 w-4 text-amber-500" />}
                </div>
                <p className="mt-0.5 text-gray-400 text-sm">{providerConfig.description}</p>
                <ul className="mt-2 space-y-1">
                  {(PROVIDER_FEATURES[providerConfig.id] ?? []).map((feature, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-gray-500 text-xs">
                      <span className="h-1 w-1 rounded-full bg-gray-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <a
                href={providerConfig.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 text-gray-500 hover:text-gray-400"
                title="View documentation"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </button>
          ))}
        </div>
      </section>

      {/* Reme's Brain Section */}
      <section className="mb-8">
        <h2 className="mb-4 font-medium text-lg text-white">Reme's Brain</h2>
        <p className="mb-4 text-gray-400 text-sm">
          Select the intelligence level for Reme. This is the same as the brain selector in chat.
        </p>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsBrainDropdownOpen(!isBrainDropdownOpen)}
            className={cn(
              'flex w-full items-center justify-between rounded-xl border px-4 py-3',
              'border-border bg-surface-tertiary transition-colors hover:border-border-strong',
              isBrainDropdownOpen && 'border-amber-500'
            )}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/20">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-amber-400"
                >
                  <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-1.17 2.83L12 12.66l-2.83-2.83A4 4 0 0 1 8 7V6a4 4 0 0 1 4-4z" />
                  <path d="M12 12.66V22" />
                  <path d="M8 7c-2.76 0-5 1.79-5 4s2.24 4 5 4" />
                  <path d="M16 7c2.76 0 5 1.79 5 4s-2.24 4-5 4" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-medium text-white">{currentTierInfo.label}</div>
                <div className="text-gray-400 text-sm">
                  {currentModel.name} — {currentModel.description}
                </div>
              </div>
            </div>
            <ChevronDown
              className={cn(
                'h-5 w-5 text-gray-500 transition-transform',
                isBrainDropdownOpen && 'rotate-180'
              )}
            />
          </button>

          {isBrainDropdownOpen && (
            <div
              className="absolute mt-2 w-full rounded-xl border border-border bg-surface-tertiary py-2 shadow-lg"
              style={{ zIndex: Z_INDEX.DROPDOWN }}
            >
              {tiers.map((tier) => {
                const tierInfo = BRAIN_TIERS[tier]
                const model = currentProvider.models[tier]
                const isSelected = brainTier === tier

                return (
                  <button
                    type="button"
                    key={tier}
                    onClick={() => handleBrainTierSelect(tier)}
                    className={cn(
                      'flex w-full items-center justify-between px-4 py-3 text-left',
                      'transition-colors hover:bg-surface-elevated',
                      isSelected && 'bg-amber-500/10'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg border',
                          isSelected
                            ? 'border-amber-500/30 bg-amber-500/20'
                            : 'border-border bg-surface-muted'
                        )}
                      >
                        {tierInfo.icon === 'sparkles' ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={isSelected ? 'text-amber-400' : 'text-gray-400'}
                          >
                            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                          </svg>
                        ) : tierInfo.icon === 'zap' ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={isSelected ? 'text-amber-400' : 'text-gray-400'}
                          >
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={isSelected ? 'text-amber-400' : 'text-gray-400'}
                          >
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'font-medium',
                              isSelected ? 'text-amber-500' : 'text-white'
                            )}
                          >
                            {tierInfo.label}
                          </span>
                          {tier === 'smart' && (
                            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-medium text-[9px] text-amber-500 uppercase tracking-wide">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="text-gray-400 text-sm">
                          {model.name} — {model.description}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-amber-500" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <p className="mt-3 text-gray-500 text-xs">
          This setting syncs with the brain selector in chat. The model used depends on both the
          provider and brain tier.
        </p>
      </section>

      {/* API Key Notice */}
      {currentProvider.requiresApiKey && currentProvider.apiKeyEnvVar && (
        <section className="mb-8">
          <div className="rounded-xl border border-border bg-surface-tertiary p-4">
            <p className="text-gray-400 text-sm">
              <span className="font-medium text-white">API Key Required:</span>{' '}
              {currentProvider.name} requires an API key. Set it in your environment variables as{' '}
              <code className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-amber-500 text-xs">
                {currentProvider.apiKeyEnvVar}
              </code>
            </p>
          </div>
        </section>
      )}

      {/* Current Configuration Summary */}
      <section className="mb-8">
        <div className="rounded-xl border border-border bg-surface-tertiary p-4">
          <h3 className="font-medium text-sm text-white mb-3">Current Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] uppercase text-gray-600 font-bold tracking-wider">
                Provider
              </span>
              <div className="mt-1 text-sm text-amber-500">{currentProvider.name}</div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-600 font-bold tracking-wider">
                Brain Tier
              </span>
              <div className="mt-1 text-sm text-amber-500">{currentTierInfo.label}</div>
            </div>
            <div className="col-span-2">
              <span className="text-[10px] uppercase text-gray-600 font-bold tracking-wider">
                Active Model
              </span>
              <div className="mt-1 text-sm text-gray-200">
                {currentModel.name}{' '}
                <span className="text-gray-500 text-xs font-mono">({currentModel.id})</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>

        {saveSuccess && (
          <span className="flex items-center gap-1.5 text-green-500 text-sm">
            <Check className="h-4 w-4" />
            Settings saved successfully
          </span>
        )}
      </div>
    </>
  )
}
