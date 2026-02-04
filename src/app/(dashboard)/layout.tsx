import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { getServerSession } from '@/lib/auth/server'
import { ROUTES } from '@/lib/constants'
import { DashboardShell } from './components/DashboardShell'
import { DashboardSkeleton } from './components/DashboardSkeleton'

export const metadata: Metadata = {
  title: 'Dashboard - Reme',
  description: 'Your AI-powered CRM assistant dashboard',
}

export const dynamic = 'force-dynamic'

interface DashboardLayoutProps {
  children: ReactNode
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const session = await getServerSession()

  if (!session) {
    redirect(ROUTES.LOGIN)
  }

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardShell user={session.user}>{children}</DashboardShell>
    </Suspense>
  )
}
