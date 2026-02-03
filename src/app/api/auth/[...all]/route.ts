import { handler } from '@/lib/auth'

/**
 * Better Auth API route handler
 * Handles all authentication endpoints: /api/auth/*
 *
 * Routes include:
 * - POST /api/auth/sign-up/email
 * - POST /api/auth/sign-in/email
 * - POST /api/auth/sign-out
 * - GET /api/auth/session
 * - etc.
 */
export const { GET, POST } = handler
