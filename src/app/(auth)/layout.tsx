import { DevModeBanner } from '@/components/dashboard/DevModeBanner'
import { isAuthDisabledInDev } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const authDisabled = isAuthDisabledInDev()

  return (
    <div className="min-h-screen bg-surface-secondary bg-linear-to-br from-surface-secondary via-surface-tertiary to-surface-secondary">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-brand/10 via-transparent to-transparent" />

      <div className="relative z-10">{children}</div>
      {authDisabled && <DevModeBanner />}
    </div>
  )
}
