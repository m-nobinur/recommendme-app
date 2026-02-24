import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-primary px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10">
            <span className="font-bold text-3xl text-brand">404</span>
          </div>
        </div>

        <h1 className="mb-2 font-semibold text-2xl text-text-primary">Page not found</h1>
        <p className="mb-6 text-text-secondary">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/chat"
            className="rounded-lg bg-brand px-6 py-2.5 font-medium text-surface-primary transition-colors hover:bg-brand-accent focus-ring"
          >
            Go to Chat
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-border bg-surface-elevated px-6 py-2.5 font-medium text-text-primary transition-colors hover:bg-surface-muted focus-ring"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
