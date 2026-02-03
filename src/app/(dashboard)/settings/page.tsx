import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SettingsForm } from './components/SettingsForm'
import { SettingsSkeleton } from './components/SettingsSkeleton'

export const metadata: Metadata = {
  title: 'Settings - Reme',
  description: 'Configure your AI assistant preferences',
}

export default function SettingsPage() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Scrollable content area with mask gradient */}
      <div
        className="custom-scrollbar flex-1 overflow-y-auto px-4 pt-6 md:px-0"
        style={{
          maskImage: 'linear-gradient(to bottom, black 95%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 95%, transparent 100%)',
        }}
      >
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 md:px-8">
          {/* Static Header - rendered immediately */}
          <div className="mb-8">
            <h1 className="font-semibold text-2xl text-white">Settings</h1>
            <p className="mt-1 text-gray-400">Configure your AI assistant preferences</p>
          </div>

          {/* Dynamic Form - streams in with Suspense */}
          <Suspense fallback={<SettingsSkeleton />}>
            <SettingsForm />
          </Suspense>
        </div>
      </div>

      {/* Bottom Gradient Overlay to match chat page */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-black via-black/80 to-transparent" />
    </div>
  )
}
