import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { getServerSession } from '@/lib/auth/server'
import { DashboardShell } from './components/DashboardShell'
import { DashboardSkeleton } from './components/DashboardSkeleton'

export const metadata: Metadata = {
  title: 'Dashboard - Reme',
  description: 'Your AI-powered CRM assistant dashboard',
}

// Dynamic rendering - auth check happens on every request
export const dynamic = 'force-dynamic'

interface DashboardLayoutProps {
  children: ReactNode
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  // Server-side auth check with redirect
  const session = await getServerSession()

  if (!session) {
    // Redirect to login without callback URL to avoid redirect loops
    redirect('/login')
  }

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardShell user={session.user}>{children}</DashboardShell>
    </Suspense>
  )
}
