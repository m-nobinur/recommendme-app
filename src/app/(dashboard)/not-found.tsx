import Link from 'next/link'

export default function DashboardNotFound() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
            <span className="font-bold text-2xl text-brand">404</span>
          </div>
        </div>

        <h2 className="mb-2 font-semibold text-text-primary text-xl">Page not found</h2>
        <p className="mb-6 text-sm text-text-secondary">
          This page doesn&apos;t exist in your dashboard.
        </p>

        <Link
          href="/chat"
          className="inline-block rounded-lg bg-brand px-5 py-2 font-medium text-surface-primary transition-colors hover:bg-brand-accent focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface-primary"
        >
          Back to Chat
        </Link>
      </div>
    </div>
  )
}
