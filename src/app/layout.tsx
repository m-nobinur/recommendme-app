import { VercelToolbar } from '@vercel/toolbar/next'
import { GeistMono, GeistSans } from 'geist/font'
import type { Metadata, Viewport } from 'next'
import { getToken } from '@/lib/auth'
import './globals.css'
import { Providers } from './providers'

// Force dynamic rendering to prevent caching of auth state
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    default: 'RecommendMe AI - Your AI-Powered CRM Assistant',
    template: '%s | RecommendMe AI',
  },
  description:
    'AI-powered CRM assistant for managing leads, scheduling appointments, and creating invoices through natural conversation.',
  keywords: ['AI', 'CRM', 'business assistant', 'leads', 'scheduling', 'invoicing', 'chatbot'],
  authors: [{ name: 'RecommendMe Team' }],
  creator: 'RecommendMe AI',
  metadataBase: new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000'),
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.svg',
  },
  openGraph: {
    title: 'RecommendMe AI',
    description: 'AI-powered CRM assistant for managing leads, scheduling, and invoicing',
    type: 'website',
    images: ['/og-image.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RecommendMe AI',
    description: 'AI-powered CRM assistant for managing leads, scheduling, and invoicing',
    images: ['/og-image.svg'],
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#020202',
  colorScheme: 'dark',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Fetch auth token on server for faster client-side authentication
  const token = await getToken()
  const shouldInjectToolbar = process.env.NODE_ENV === 'development'

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} bg-surface-primary font-sans text-text-primary antialiased`}
        suppressHydrationWarning
      >
        <Providers initialToken={token}>{children}</Providers>
        {shouldInjectToolbar && <VercelToolbar />}
      </body>
    </html>
  )
}
