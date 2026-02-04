import { type NextRequest, NextResponse } from 'next/server'
import { ROUTES } from '@/lib/constants'

// Routes that require authentication
const protectedRoutes = [ROUTES.CHAT, ROUTES.SETTINGS]

// Routes that should redirect to /chat if already authenticated
const authRoutes = [ROUTES.LOGIN, ROUTES.REGISTER]

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isDev = process.env.NODE_ENV === 'development'
  const authDisabled = isDev && process.env.DISABLE_AUTH_IN_DEV === 'true'

  if (authDisabled) {
    if (pathname === '/') {
      console.log('🔓 [DEV MODE] Authentication disabled - all routes accessible')
    }
    return NextResponse.next()
  }

  const sessionToken =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  const isAuthenticated = !!sessionToken

  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  const isAuthRoute = authRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users to chat
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL(ROUTES.CHAT, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - public folder files
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)',
  ],
}
