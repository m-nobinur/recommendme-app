import { type NextRequest, NextResponse } from 'next/server'

// Routes that require authentication
const protectedRoutes = ['/chat', '/settings']

// Routes that should redirect to /chat if already authenticated
const authRoutes = ['/login', '/register']

/**
 * Next.js 16 Proxy
 * Replaces middleware.ts - runs on Node.js runtime
 * Handles authentication redirects at the network boundary
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if auth is disabled in development
  const isDev = process.env.NODE_ENV === 'development'
  const authDisabled = isDev && process.env.DISABLE_AUTH_IN_DEV === 'true'

  // If auth is disabled in dev, allow all requests through
  if (authDisabled) {
    // Log once per session for visibility
    if (pathname === '/') {
      console.log('🔓 [DEV MODE] Authentication disabled - all routes accessible')
    }
    return NextResponse.next()
  }

  // Get the session token from cookies
  // better-auth stores session in a cookie named "better-auth.session_token"
  const sessionToken =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  const isAuthenticated = !!sessionToken

  // Check if the current path is protected
  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  // Check if current path is an auth route
  const isAuthRoute = authRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  // Redirect unauthenticated users from protected routes to login
  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users from auth routes to chat
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/chat', request.url))
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
