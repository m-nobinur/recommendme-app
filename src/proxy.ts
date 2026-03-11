import { type NextRequest, NextResponse } from 'next/server'
import { COOKIES, ROUTES } from '@/lib/constants'

const PROTECTED_ROUTES = [ROUTES.CHAT, ROUTES.MEMORY, ROUTES.SETTINGS]
const AUTH_ROUTES = [ROUTES.LOGIN, ROUTES.REGISTER]

function hasSessionToken(request: NextRequest): boolean {
  return !!(
    request.cookies.get(COOKIES.SESSION)?.value ||
    request.cookies.get(COOKIES.SESSION_SECURE)?.value
  )
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isDev = process.env.NODE_ENV === 'development'
  const authEnvDisabled = isDev && process.env.DISABLE_AUTH_IN_DEV === 'true'

  if (authEnvDisabled) {
    const devAuthMode = request.cookies.get(COOKIES.DEV_AUTH_MODE)?.value ?? 'dev'
    if (devAuthMode === 'dev') {
      return NextResponse.next()
    }
  }

  const isAuthenticated = hasSessionToken(request)

  const isProtectedRoute = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL(ROUTES.CHAT, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\..*).*)',
  ],
}
