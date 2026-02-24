import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/ui/Logo'
import { getServerSession } from '@/lib/auth/server'
import { ROUTES } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await getServerSession()

  if (session) {
    redirect(ROUTES.CHAT)
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface-primary">
      {/* Background gradient effect */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/4 -left-1/4 h-[600px] w-[600px] rounded-full bg-brand/5 blur-3xl" />
        <div className="absolute -right-1/4 -bottom-1/4 h-[500px] w-[500px] rounded-full bg-brand-secondary/5 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-2xl px-4 text-center">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-elevated shadow-lg ring-1 ring-border">
            <Logo size={48} />
          </div>
        </div>

        {/* Title */}
        <h1 className="mb-4 text-gradient-brand font-bold text-4xl tracking-tight sm:text-5xl">
          RecommendMe AI
        </h1>

        <p className="mb-2 text-text-primary text-xl">Your intelligent CRM assistant</p>

        <p className="mb-8 text-text-secondary">
          Manage leads, appointments, and invoices with the power of AI. Natural language interface
          for all your business needs.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Link
            href={ROUTES.REGISTER}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-8 py-3 font-semibold text-surface-primary transition-all hover:bg-brand-accent hover:shadow-brand/20 hover:shadow-lg focus-ring"
          >
            Get Started
          </Link>
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface-elevated px-8 py-3 font-semibold text-text-primary transition-colors hover:bg-surface-muted focus-ring"
          >
            Sign In
          </Link>
        </div>

        {/* Features */}
        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface-elevated/50 p-6 backdrop-blur-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10">
              <svg
                className="h-5 w-5 text-brand"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h3 className="mb-1 font-semibold text-text-primary">Lead Management</h3>
            <p className="text-sm text-text-secondary">
              Track and nurture leads with natural language commands
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface-elevated/50 p-6 backdrop-blur-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10">
              <svg
                className="h-5 w-5 text-brand"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="mb-1 font-semibold text-text-primary">Appointments</h3>
            <p className="text-sm text-text-secondary">Schedule and manage meetings effortlessly</p>
          </div>

          <div className="rounded-xl border border-border bg-surface-elevated/50 p-6 backdrop-blur-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10">
              <svg
                className="h-5 w-5 text-brand"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="mb-1 font-semibold text-text-primary">Invoicing</h3>
            <p className="text-sm text-text-secondary">
              Create and track invoices with AI assistance
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-4 text-sm text-text-muted">Powered by AI</footer>
    </div>
  )
}
